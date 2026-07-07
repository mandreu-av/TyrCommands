import { statSync } from 'fs';
import type { TyrContext, TaskPriority } from '@orxataguy/tyr';

/**
 * Generates AI context documentation (AGENTS.md-style) from the project's code.
 *
 * Usage:
 *   tyr ai:describe                                Scans the project (cwd) and generates/overwrites AGENTS.md
 *   tyr ai:describe <directory>                     Same, but for <directory> (relative or absolute)
 *   tyr ai:describe <file> [--priority <level>]      Describes a single file → AGENTS_<file>.md
 *
 * This command is intentionally thin: it only resolves the target, builds the seed prompt (project
 * tree + README for a project, or the file's content for a single file), and hands everything else
 * to AIContextManager.runDescribeAgent(), which owns the tool-use exploration loop (list_directory,
 * read_file, read_manifest, etc. — see AIContextManager.AGENT_TOOLS). AIContextManager also decides
 * the default routing priority per case (baja-media-prioridad for a single file, per the routing
 * matrix in AIVendorManager) unless overridden with --priority.
 *
 * Also consults MemoryManager for past conversations relevant to this target (deterministic
 * keyword match, no extra AI call) and records this run once it succeeds.
 */

const AGENTS_MD_FILENAME = 'AGENTS.md';

// Above this size, default a single-file description to a higher-capability tier than the
// baja-media-prioridad AIContextManager uses by default — a simple, explicit heuristic, easy to
// override with --priority.
const LARGE_FILE_PRIORITY_THRESHOLD_CHARS = 20000;

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

export default ({ fail, logger, fs, path, aiContext, prompts, tokens, memory }: TyrContext) => {
    return async (args: string[]) => {
        logger.info('Running command: ai:describe');

        const positional = args.filter(a => !a.startsWith('--'));
        const flagPriority = parseFlag(args, '--priority') as TaskPriority | undefined;

        const cwd = process.cwd();
        const targetArg = positional[0];
        const resolvedArg = targetArg ? path.resolve(cwd, targetArg) : null;

        if (!targetArg || (resolvedArg && isDirectory(resolvedArg))) {
            const projectDir = resolvedArg ?? cwd;
            logger.info(`Scanning project at: ${projectDir}`);

            const tree = await aiContext.buildExplorationTree(projectDir);
            const readme = await aiContext.findReadme(projectDir);
            const readmeSection = readme
                ? `# ${readme.name} (guidance, not the only source)\n${readme.content}`
                : '(no README found)';

            const messages = prompts.buildStandalone('ai-describe-project', { tree, readme: readmeSection });

            const memoryMessage = await memory.getContextMessage(projectDir, 'describe this project');
            if (memoryMessage) messages.push(memoryMessage);

            logger.info('Generating AGENTS.md with AI (the model may request more context before answering; this can take more than one call)...');
            const result = await aiContext.runDescribeAgent(projectDir, messages, tokens, { priority: flagPriority });

            const outputPath = path.join(projectDir, AGENTS_MD_FILENAME);
            const finalContent = `${result.content.trim()}\n\n## Project structure\n\n\`\`\`\n${tree}\n\`\`\`\n`;
            await fs.write(outputPath, finalContent);

            logger.success(`File generated: ${outputPath}`);
            logger.info(`Model calls: ${result.toolCallsUsed} tool call(s), priority "${result.priorityUsed}", ${result.promptTokens + result.completionTokens} tokens.`);

            const memoryPath = await memory.recordConversation(projectDir, {
                command: 'ai:describe',
                history: [{ role: 'user', text: 'Describe this project and generate AGENTS.md.' }],
                filesChanged: [AGENTS_MD_FILENAME],
            });
            logger.info(`Conversation saved to memory: ${memoryPath}`);
            return;
        }

        const filePath = resolvedArg as string;
        if (!fs.exists(filePath)) {
            fail(`File does not exist: ${filePath}`, 'Check the given path.');
        }

        const fileContent = await fs.read(filePath);
        if (!fileContent || !fileContent.trim()) {
            fail(`File is empty or unreadable: ${filePath}`);
        }

        const hasGuidelines = aiContext.findContextFiles(cwd).length > 0;
        const context = hasGuidelines
            ? `Project context (${AGENTS_MD_FILENAME}):\n${await aiContext.getGuidelinesText(cwd)}`
            : '(no existing AGENTS.md for this project)';

        const messages = prompts.buildStandalone('ai-describe-file', {
            path: path.relative(cwd, filePath),
            content: fileContent as string,
            context,
        });

        const relFilePath = path.relative(cwd, filePath);
        const memoryMessage = await memory.getContextMessage(cwd, `describe file ${relFilePath}`);
        if (memoryMessage) messages.push(memoryMessage);

        const sizeHeuristic: TaskPriority | undefined =
            (fileContent as string).length > LARGE_FILE_PRIORITY_THRESHOLD_CHARS ? 'media-prioridad' : undefined;

        logger.info(`Generating description for: ${relFilePath}`);
        const result = await aiContext.runDescribeAgent(cwd, messages, tokens, { priority: flagPriority ?? sizeHeuristic });

        const baseName = path.basename(filePath, path.extname(filePath));
        const outputPath = path.join(cwd, `AGENTS_${baseName}.md`);
        await fs.write(outputPath, result.content.trim() + '\n');

        logger.success(`File generated: ${outputPath}`);
        logger.info(`Model calls: ${result.toolCallsUsed} tool call(s), priority "${result.priorityUsed}", ${result.promptTokens + result.completionTokens} tokens.`);

        const memoryPath = await memory.recordConversation(cwd, {
            command: 'ai:describe',
            history: [{ role: 'user', text: `Describe file ${relFilePath}.` }],
            filesChanged: [path.basename(outputPath)],
        });
        logger.info(`Conversation saved to memory: ${memoryPath}`);
    };
};

export const Test = { args: [] };