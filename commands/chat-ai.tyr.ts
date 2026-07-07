import { statSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import type { TyrContext, TaskPriority } from '@orxataguy/tyr';
import { TASK_PRIORITIES } from '@orxataguy/tyr';

/**
 * Opens a local chat + file browser UI backed by the configured AI vendor.
 *
 * Usage:
 *   tyr ai:chat                                              Chats about the current directory
 *   tyr ai:chat <directory>                                   Chats about <directory> (relative or absolute)
 *   tyr ai:chat ["<directory>"] --port <port> --split <ratio> --priority <level>
 *
 * Unlike the framework's built-in `chat` command, this one feeds the project's guidelines
 * (AGENTS.md/CLAUDE.md, via AIContextManager.getContext()) into the system prompt and routes
 * every reply through AIVendorManager's priority ladder (see TaskPriority), so the model
 * answering in the browser is grounded on the same project context ai:code/ai:describe use.
 *
 * It also maintains a "context of interest" (see ChatManager.addToContext/getContext), a set of
 * files the conversation is grounded on and that the file browser highlights (📌). A file joins it
 * three ways: the user double-clicks it in the browser (handled entirely by ChatManager), this
 * command deterministically detects a mention of it in the user's message text, or the model
 * itself asks for it via the add_files_to_context tool when it decides it needs to see one. Every
 * file currently in context has its full content injected into the prompt on every turn, so once
 * added a file stays "known" for the rest of the conversation without being re-requested.
 *
 * The model can also write to disk: it has a generate_or_modify_code tool that delegates to
 * AIContextManager.runCodeAgent() (the exact same pipeline ai:code uses — Search/Replace patches,
 * the blind-overwrite guard, post-write validation AND now a sandboxed test/build check) so a
 * request to create/modify/fix a file is actually carried out, not just described. Changed files
 * are added to the context of interest automatically, and every diff produced is appended to the
 * chat reply verbatim (never re-transcribed by the model) so the human always sees exactly what
 * changed.
 *
 * Two more things carried over from ai:code/ai:describe: a read-only git_diff tool (status + diff
 * of the working tree — never stages or commits, see AIContextManager.AGENT_TOOLS) the model can
 * call to see what's already changed before editing further, and MemoryManager — every closed
 * chat session is compacted (deterministically, no extra AI call) into ~/.tyr/.tyr-mem/, and on
 * every turn the current message is checked against that project's past conversations; a relevant
 * match (above a minimum keyword-overlap score) is spliced in as extra context, so this is never a
 * blind dump of everything ever said.
 *
 * The chat header also exposes an effort ceiling (see AIVendorManager.setPriorityCeiling): a
 * developer-controlled cap that neither a normal turn nor a self-heal escalation can ever exceed,
 * so an expensive model tier never gets used for a task you didn't judge as needing it.
 *
 * This command is intentionally thin on mechanics (attachments, history, the file browser, context
 * storage/highlighting, the priority-ceiling dropdown all live in ChatManager/AIVendorManager) but
 * owns the AI-specific parts: mention detection, assembling the context-files/memory blocks, and
 * the small tool-use loop that lets the model pull in a file or write code on its own.
 */

const DEFAULT_PRIORITY: TaskPriority = 'media-prioridad';

// Directories never worth indexing for mention detection: not part of the project's own source,
// or so large they'd blow the file count budget for no benefit.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache', 'vendor']);
const MAX_INDEXED_FILES = 20000;

// A mentioned/requested file is only worth injecting as text if it plausibly IS text.
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.pdf', '.zip', '.tar', '.gz',
    '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav', '.mov', '.exe', '.dll', '.so', '.dylib',
    '.bin', '.wasm',
]);

const MAX_MENTION_MATCHES_PER_MESSAGE = 6;
const MAX_CONTEXT_FILE_CHARS = 8000;
const MAX_TOTAL_CONTEXT_CHARS = 60000;
const MAX_TOOL_ROUNDS = 4;

const ADD_FILES_TO_CONTEXT_TOOL = {
    name: 'add_files_to_context',
    description:
        "Adds one or more project files to the conversation's shared context of interest, so their " +
        'full content becomes available to you (and stays highlighted for the user in the file ' +
        'browser) for the rest of the conversation. Call this when you need to see a file that is ' +
        'not already included below, or that you judge important enough to keep grounding the ' +
        'discussion on. Paths are relative to the project root.',
    input_schema: {
        type: 'object',
        properties: {
            paths: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the project root.' },
        },
        required: ['paths'],
    },
};

const GENERATE_OR_MODIFY_CODE_TOOL = {
    name: 'generate_or_modify_code',
    description:
        'Actually creates new files or modifies/deletes existing ones in the project — use this ' +
        'whenever the user asks you to generate, write, create, add, modify, fix, or refactor code ' +
        'or files. Do NOT just describe the change in your reply: call this tool to make it happen, ' +
        'then summarize the result. Runs a specialized code-writing agent with full read/write access ' +
        'to the project; give it a precise, self-contained instruction (it does not see this chat ' +
        "history, only the instruction you pass here and the project's own files).",
    input_schema: {
        type: 'object',
        properties: {
            instruction: {
                type: 'string',
                description: 'Precise, self-contained description of the file(s) to create or the changes to make.',
            },
        },
        required: ['instruction'],
    },
};

const GIT_DIFF_TOOL = {
    name: 'git_diff',
    description:
        "Shows the project's current git status and diff (uncommitted changes vs. HEAD), if it is " +
        'a git repository. Read-only: this tool can only inspect the working tree, it can NEVER ' +
        'stage (git add) or commit anything.',
    input_schema: {
        type: 'object',
        properties: {
            staged: { type: 'boolean', description: 'If true, show the staged diff instead of the unstaged working-tree diff.' },
        },
    },
};

interface FileIndex {
    byPath: Set<string>;
    byBase: Map<string, string[]>;
}

function isDirectory(target: string): boolean {
    try {
        return statSync(target).isDirectory();
    } catch {
        return false;
    }
}

function parseFlag(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index !== -1 ? args[index + 1] : undefined;
}

/** Bounded recursive walk of `rootDir`, collecting relative (forward-slash) file paths for mention
 *  detection. Ignores the same kind of noise directories ChatManager's file browser skips, plus a
 *  few more that are never worth matching against (build output, vendored deps). */
async function indexFiles(rootDir: string): Promise<string[]> {
    const results: string[] = [];

    async function walk(dir: string, relBase: string): Promise<void> {
        if (results.length >= MAX_INDEXED_FILES) return;

        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= MAX_INDEXED_FILES) return;
            if (entry.name === '.DS_Store' || IGNORED_DIRS.has(entry.name)) continue;

            const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(path.join(dir, entry.name), rel);
            } else if (entry.isFile()) {
                results.push(rel);
            }
        }
    }

    await walk(rootDir, '');
    return results;
}

function buildFileIndex(paths: string[]): FileIndex {
    const byPath = new Set(paths);
    const byBase = new Map<string, string[]>();

    for (const p of paths) {
        const base = p.split('/').pop() ?? p;
        const existing = byBase.get(base);
        if (existing) existing.push(p);
        else byBase.set(base, [p]);
    }

    return { byPath, byBase };
}

/** Deterministic, cheap (no AI call) detection of file mentions in a chat message: pulls out
 *  filename-like tokens (contain a dot followed by an extension) and looks them up against the
 *  index, first as a full relative path, then by basename. */
function detectMentionedFiles(text: string, index: FileIndex): string[] {
    if (!text) return [];

    const tokens = text.match(/[\w./-]+\.[A-Za-z0-9]+/g) ?? [];
    const matches = new Set<string>();

    for (const rawToken of tokens) {
        if (matches.size >= MAX_MENTION_MATCHES_PER_MESSAGE) break;

        const token = rawToken.replace(/^[.,;:!?'"()]+|[.,;:!?'"()]+$/g, '');
        if (index.byPath.has(token)) {
            matches.add(token);
            continue;
        }

        const base = token.split('/').pop() ?? token;
        const candidates = index.byBase.get(base);
        if (!candidates) continue;
        for (const candidate of candidates) {
            if (matches.size >= MAX_MENTION_MATCHES_PER_MESSAGE) break;
            matches.add(candidate);
        }
    }

    return [...matches];
}

export default ({ fail, logger, fs, path: fwPath, aiContext, aiVendor, chat, prompts, tokens, memory, git }: TyrContext) => {
    return async (args: string[]) => {
        logger.info('Running command: ai:chat');

        const priority = (parseFlag(args, '--priority') as TaskPriority | undefined) ?? DEFAULT_PRIORITY;
        const portArg = parseFlag(args, '--port');
        const splitArg = parseFlag(args, '--split');
        const port = portArg ? parseInt(portArg, 10) : undefined;
        const splitRatio = splitArg ? parseFloat(splitArg) : undefined;

        const positional = args.filter(a => !a.startsWith('--') && a !== portArg && a !== splitArg);
        const cwd = process.cwd();
        const targetDir = positional[0] ? fwPath.resolve(cwd, positional[0]) : cwd;

        if (!isDirectory(targetDir)) {
            fail(`Directory does not exist: ${targetDir}`, 'Check the given path.');
        }

        logger.info(`Browsing: ${targetDir}`);
        logger.info(`Routing priority: ${priority}`);

        const contextMessages = await aiContext.getContext(targetDir);

        const fileIndex = buildFileIndex(await indexFiles(targetDir));
        logger.info(`Indexed ${fileIndex.byPath.size} file(s) for mention detection.`);

        async function readContextFileContent(relPath: string): Promise<string> {
            const ext = fwPath.extname(relPath).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) return '(binary file — content omitted)';

            const content = await fs.read(fwPath.join(targetDir, relPath));
            if (content == null) return '(could not be read)';
            if (content.length <= MAX_CONTEXT_FILE_CHARS) return content;
            return `${content.slice(0, MAX_CONTEXT_FILE_CHARS)}\n... (truncated, ${content.length - MAX_CONTEXT_FILE_CHARS} more characters)`;
        }

        async function buildContextFilesMessage(contextPaths: string[]): Promise<any | null> {
            if (contextPaths.length === 0) return null;

            let budget = MAX_TOTAL_CONTEXT_CHARS;
            const sections: string[] = [];
            let omitted = 0;

            for (const relPath of contextPaths) {
                const body = await readContextFileContent(relPath);
                if (body.length + 50 > budget) {
                    omitted++;
                    continue;
                }
                budget -= body.length;
                sections.push(`### ${relPath}\n\`\`\`\n${body}\n\`\`\``);
            }

            const omittedNote = omitted > 0
                ? `\n\n(${omitted} more context file(s) omitted here for size — ask explicitly if you need them.)`
                : '';

            return {
                role: 'system',
                content:
                    "Files currently in the conversation's context of interest — you don't need to ask " +
                    `for these, their full content is already here:\n\n${sections.join('\n\n')}${omittedNote}`,
            };
        }

        async function executeAddFilesToContext(call: any, sessionId: string): Promise<any> {
            const requested: string[] = Array.isArray(call.input?.paths)
                ? call.input.paths.filter((p: unknown) => typeof p === 'string')
                : [];
            if (requested.length === 0) {
                return { type: 'tool_result', tool_use_id: call.id, content: 'No valid paths were provided.', is_error: true };
            }

            const added: string[] = await chat.addToContext(sessionId, requested);
            logger.info(`[ai:chat] AI added to context: ${added.length > 0 ? added.join(', ') : '(none — invalid or already present)'}`);

            if (added.length === 0) {
                return {
                    type: 'tool_result',
                    tool_use_id: call.id,
                    content: 'None of the requested paths could be added (missing, not a file, already in context, or outside the project).',
                };
            }

            const sections = await Promise.all(added.map(async (p) => `${p}:\n${await readContextFileContent(p)}`));
            const skipped = requested.length - added.length;
            const note = skipped > 0
                ? `\n\n(${skipped} of the requested path(s) were skipped — missing, not a file, or already in context.)`
                : '';

            return { type: 'tool_result', tool_use_id: call.id, content: sections.join('\n\n') + note };
        }

        const filesChangedThisSession = new Set<string>();

        async function executeGenerateOrModifyCode(call: any, sessionId: string, diffSink: any[]): Promise<any> {
            const instruction = typeof call.input?.instruction === 'string' ? call.input.instruction.trim() : '';
            if (!instruction) {
                return { type: 'tool_result', tool_use_id: call.id, content: 'No instruction was provided.', is_error: true };
            }

            logger.info(`[ai:chat] delegating to code agent: ${instruction}`);
            const tree = await aiContext.buildExplorationTree(targetDir);
            const codeMessages = await prompts.build('ai-code', { task: instruction, tree }, targetDir);
            const result = await aiContext.runCodeAgent(targetDir, codeMessages, tokens, { priority });

            if (result.filesChanged.length > 0) {
                await chat.addToContext(sessionId, result.filesChanged);
                result.filesChanged.forEach((f: string) => filesChangedThisSession.add(f));
                diffSink.push(...result.fileDiffs);
            }

            const summaryLines: string[] = [];
            if (result.filesChanged.length > 0) summaryLines.push(`Changed: ${result.filesChanged.join(', ')}`);
            if (result.blockedWrites.length > 0) {
                summaryLines.push(`Blocked (would have overwritten content not read this session): ${result.blockedWrites.join(', ')}`);
            }
            if (result.failedEdits.length > 0) summaryLines.push(`Failed edits (SEARCH text not found): ${result.failedEdits.join(', ')}`);
            if (result.validation.ran) summaryLines.push(`Validation: ${result.validation.ok ? 'passed' : 'still failing after self-healing attempts'}`);
            if (result.sandbox.ran) summaryLines.push(`Sandbox check (${result.sandbox.command}): ${result.sandbox.ok ? 'passed' : 'still failing after self-healing attempts'}`);
            if (summaryLines.length === 0) summaryLines.push('No file changes were produced.');

            logger.info(`[ai:chat] code agent result: ${summaryLines.join(' | ')}`);
            return { type: 'tool_result', tool_use_id: call.id, content: summaryLines.join('\n') };
        }

        async function executeGitDiff(call: any): Promise<any> {
            const status = await git.status(targetDir);
            const diff = await git.diff(targetDir, { staged: !!call.input?.staged });
            return { type: 'tool_result', tool_use_id: call.id, content: `Status:\n${status}\n\nDiff:\n${diff}` };
        }

        async function executeTool(call: any, sessionId: string, diffSink: any[]): Promise<any> {
            if (call.name === 'add_files_to_context') return executeAddFilesToContext(call, sessionId);
            if (call.name === 'generate_or_modify_code') return executeGenerateOrModifyCode(call, sessionId, diffSink);
            if (call.name === 'git_diff') return executeGitDiff(call);
            return { type: 'tool_result', tool_use_id: call.id, content: `Unknown tool: ${call.name}`, is_error: true };
        }

        async function generateReply(messages: any[], sessionId: string): Promise<{ text: string; diffs: any[] }> {
            const diffs: any[] = [];

            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const allowTools = round < MAX_TOOL_ROUNDS - 1;
                const result = await aiVendor.completeWithPriority(
                    messages,
                    priority,
                    allowTools ? { tools: [ADD_FILES_TO_CONTEXT_TOOL, GENERATE_OR_MODIFY_CODE_TOOL, GIT_DIFF_TOOL] } : {}
                );

                const toolUses = result.blocks.filter((b: any) => b.type === 'tool_use');
                if (toolUses.length === 0) return { text: result.content, diffs };

                messages.push({ role: 'assistant', content: result.blocks });
                const toolResults = await Promise.all(toolUses.map((call: any) => executeTool(call, sessionId, diffs)));
                messages.push({ role: 'user', content: toolResults });
            }

            return { text: '(Could not finish the reply after several tool calls.)', diffs };
        }

        chat.onMessage(async ({ message, history, dir, sessionId }: any) => {
            const mentioned = detectMentionedFiles(message.text, fileIndex);
            if (mentioned.length > 0) {
                const added: string[] = await chat.addToContext(sessionId, mentioned);
                if (added.length > 0) logger.info(`[ai:chat] detected file mention(s), added to context: ${added.join(', ')}`);
            }

            const priorTurns = history.slice(0, -1).map((m: any) => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text,
            }));

            const contentBlocks: any[] = [];
            if (message.text) contentBlocks.push({ type: 'text', text: message.text });

            for (const attachment of message.attachments) {
                try {
                    const fileBuffer = await readFile(attachment.path);
                    contentBlocks.push({ type: 'image', mediaType: attachment.mimeType, data: fileBuffer.toString('base64') });
                } catch (e) {
                    logger.warn(`Could not read attachment '${attachment.filename}': ${(e as Error).message}`);
                }
            }

            const contextFilesMessage = await buildContextFilesMessage(chat.getContext(sessionId));
            const memoryMessage = await memory.getContextMessage(targetDir, message.text);

            const messages: any[] = [
                ...contextMessages,
                {
                    role: 'system',
                    content:
                        `You are an assistant embedded in a chat UI browsing the directory: ${dir}. Answer ` +
                        'helpfully and concisely, referencing its files when relevant. Use the ' +
                        'add_files_to_context tool if you need to see a file that is not already included ' +
                        'below, and git_diff if you need to see the project\'s current uncommitted changes ' +
                        '(read-only — it can never stage or commit). When the user asks you to create, write, ' +
                        'generate, modify, fix, delete, or refactor any file, you MUST call ' +
                        'generate_or_modify_code to actually perform the change — never just describe or show ' +
                        'what you would write. After it runs, summarize what was actually changed.',
                },
                ...(contextFilesMessage ? [contextFilesMessage] : []),
                ...(memoryMessage ? [memoryMessage] : []),
                ...priorTurns,
                { role: 'user', content: contentBlocks.length > 0 ? contentBlocks : message.text },
            ];

            const reply = await generateReply(messages, sessionId);
            const diffBlock = reply.diffs.length > 0
                ? `\n\n${reply.diffs.map((d: any) => `\`\`\`diff\n${d.diff}\n\`\`\``).join('\n\n')}`
                : '';
            return reply.text + diffBlock;
        });

        chat.on('message:send', ({ message }: { message: { text: string } }) => {
            logger.info(`[ai:chat] user: ${message.text}`);
        });
        chat.on('message:error', ({ error }: { error: Error }) => {
            logger.warn(`[ai:chat] handler failed: ${error.message}`);
        });
        chat.on('context:change', ({ files }: { files: string[] }) => {
            logger.info(`[ai:chat] context of interest: ${files.length > 0 ? files.join(', ') : '(empty)'}`);
        });
        chat.on('priority:change', ({ value }: { value: string }) => {
            aiVendor.setPriorityCeiling(value as TaskPriority);
            logger.info(`[ai:chat] effort ceiling set to: ${value}`);
        });
        chat.on('chat:close', async ({ dir, history }: { dir: string; history: any[] }) => {
            if (history.length === 0) return;
            const filePath = await memory.recordConversation(dir, {
                command: 'ai:chat',
                history: history.map((h: any) => ({ role: h.role === 'user' ? 'user' : 'assistant', text: h.text })),
                filesChanged: [...filesChangedThisSession],
            });
            logger.info(`[ai:chat] conversation saved to memory: ${filePath}`);
        });

        try {
            const session = await chat.open(targetDir, {
                port,
                splitRatio,
                priorityCeiling: { levels: TASK_PRIORITIES, initial: priority },
            });
            logger.success(`Chat ready at: ${session.url}`);
            logger.info(`Browsing: ${session.dir}`);
            logger.info('Press Ctrl+C to stop.');
        } catch (e: any) {
            fail(`Could not start chat: ${e.message}`, 'Check that the directory exists and the port is free.');
        }
    };
};

export const Test = { args: [] };
