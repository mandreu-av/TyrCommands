import { statSync } from 'fs';
import type { TyrContext, TaskPriority } from '@orxataguy/tyr';

/**
 * Asks the AI to write or modify code inside a project.
 *
 * Usage:
 *   tyr ai:code "<prompt>"                                  Works on the current directory
 *   tyr ai:code <directory> "<prompt>"                      Works on <directory> (relative or absolute)
 *   tyr ai:code ["<directory>"] "<prompt>" --priority <lvl>  Overrides the routing priority
 *
 * Priority levels (see TaskPriority / AIVendorManager.resolvePriority): baja-prioridad,
 * baja-media-prioridad, media-prioridad (default), media-alta-prioridad, alta-prioridad,
 * muy-alta-prioridad.
 *
 * If the working directory has no AGENTS.md, ai:describe is delegated to first (ai:code is not
 * responsible for generating that file itself).
 *
 * This command is intentionally thin: it only resolves paths, ensures AGENTS.md exists, builds the
 * seed prompt (project tree + task — AGENTS.md is added automatically by PromptTemplateManager),
 * and hands everything else to AIContextManager.runCodeAgent(), which owns the tool-use
 * exploration loop, the Search/Replace patch engine, the blind-overwrite guard, post-write
 * validation, a sandboxed test/build check, and priority escalation on failure. See
 * AIContextManager for that logic.
 *
 * Also consults MemoryManager for past conversations relevant to this prompt (deterministic
 * keyword match, no extra AI call — nothing is injected unless it's actually likely to help), and
 * records this run once it succeeds so future ai:code/ai:chat calls on the same project can find it.
 */

const AGENTS_MD_FILENAME = 'AGENTS.md';
const MAX_DIFF_LOG_CHARS = 4000;

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

function stripFlag(args: string[], name: string): string[] {
    const index = args.indexOf(name);
    if (index === -1) return args;
    return [...args.slice(0, index), ...args.slice(index + 2)];
}

export default ({ run, fail, logger, fs, path, aiContext, prompts, tokens, memory }: TyrContext) => {
    return async (args: string[]) => {
        logger.info('Running command: ai:code');

        const priority = parseFlag(args, '--priority') as TaskPriority | undefined;
        const positional = stripFlag(args, '--priority');

        const cwd = process.cwd();
        let targetDir = cwd;
        let promptArgs = positional;

        if (positional.length > 0) {
            const candidate = path.resolve(cwd, positional[0]);
            if (isDirectory(candidate)) {
                targetDir = candidate;
                promptArgs = positional.slice(1);
            }
        }

        const prompt = promptArgs.join(' ').trim();
        if (!prompt) {
            fail('You must specify what you want the AI to do.', 'Usage: tyr ai:code ["<directory>"] "<prompt>" [--priority <level>]');
        }
        if (!isDirectory(targetDir)) {
            fail(`Directory does not exist: ${targetDir}`, 'Check the given path.');
        }

        const agentsMdPath = path.join(targetDir, AGENTS_MD_FILENAME);
        if (!fs.exists(agentsMdPath)) {
            logger.info(`No ${AGENTS_MD_FILENAME} found in ${targetDir}, generating it with ai:describe first...`);
            await run('ai:describe', [targetDir]);
        }

        logger.info(`Working on: ${targetDir}`);
        logger.info(`Task: ${prompt}`);

        const tree = await aiContext.buildExplorationTree(targetDir);
        const messages = await prompts.build('ai-code', { task: prompt, tree }, targetDir);

        const memoryMessage = await memory.getContextMessage(targetDir, prompt);
        if (memoryMessage) messages.push(memoryMessage);

        logger.info('Generating code with AI (the model may request more context before answering)...');
        const result = await aiContext.runCodeAgent(targetDir, messages, tokens, { priority });

        if (result.filesChanged.length === 0) {
            if (result.blockedWrites.length > 0) {
                fail(
                    `No file was written: every returned block tried to overwrite an existing file not read this session (${result.blockedWrites.join(', ')}).`,
                    'Re-run the task: the model should request those files with read_file before rewriting them.'
                );
            }
            fail(
                'No valid file changes were generated.',
                'Try rephrasing the prompt to be more explicit about what to create or modify.'
            );
        }

        logger.success(`Command ai:code finished! ${result.filesChanged.length} file(s) changed: ${result.filesChanged.join(', ')}`);

        if (result.blockedWrites.length > 0) {
            logger.info(`${result.blockedWrites.length} block(s) rejected for safety (blind overwrite): ${result.blockedWrites.join(', ')}`);
        }
        if (result.failedEdits.length > 0) {
            logger.info(`${result.failedEdits.length} edit(s) could not be applied (SEARCH text not found): ${result.failedEdits.join(', ')}`);
        }
        if (result.validation.ran) {
            logger.info(`Post-write validation: ${result.validation.ok ? 'passed' : 'still failing after self-healing attempts'}.`);
        }
        if (result.sandbox.ran) {
            logger.info(`Sandbox check (${result.sandbox.command}): ${result.sandbox.ok ? 'passed' : 'still failing after self-healing attempts'}.`);
        }

        for (const fileDiff of result.fileDiffs) {
            const diff = fileDiff.diff.length > MAX_DIFF_LOG_CHARS
                ? `${fileDiff.diff.slice(0, MAX_DIFF_LOG_CHARS)}\n... (truncated, ${fileDiff.diff.length - MAX_DIFF_LOG_CHARS} more characters)`
                : fileDiff.diff;
            logger.info(`--- diff: ${fileDiff.path} ---\n${diff}`);
        }

        logger.info(`Model calls: ${result.toolCallsUsed} tool call(s), final priority "${result.priorityUsed}", ${result.promptTokens + result.completionTokens} tokens.`);

        const memoryPath = await memory.recordConversation(targetDir, {
            command: 'ai:code',
            history: [{ role: 'user', text: prompt }],
            filesChanged: result.filesChanged,
        });
        logger.info(`Conversation saved to memory: ${memoryPath}`);
    };
};

export const Test = { args: [] };