import type { TyrContext } from '@orxataguy/tyr';

const JS_TS_EXTENSIONS: Set<string> = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

interface FileSummary {
    extension: string;
    lineCount: number;
    sizeBytes: number;
    sizeApproxKb: string;
    relativeSourcePath: string;
}

function getTestFilePath(filePath: string, pathManager: TyrContext['path']): string {
    const directory: string = pathManager.dirname(filePath);
    const extension: string = pathManager.extname(filePath);
    const baseName: string = pathManager.basename(filePath, extension);

    if (!extension) {
        return pathManager.join(directory, `${baseName}.test.txt`);
    }

    return pathManager.join(directory, `${baseName}.test${extension}`);
}

function buildFileSummary(filePath: string, content: string, pathManager: TyrContext['path']): FileSummary {
    const extension: string = pathManager.extname(filePath);
    const lineCount: number = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    const sizeBytes: number = Buffer.byteLength(content, 'utf8');
    const sizeApproxKb: string = (sizeBytes / 1024).toFixed(2);
    const relativeSourcePath: string = pathManager.relative(process.cwd(), filePath) || pathManager.basename(filePath);

    return {
        extension,
        lineCount,
        sizeBytes,
        sizeApproxKb,
        relativeSourcePath,
    };
}

function buildSuggestedCases(content: string): string[] {
    const suggestedCases: string[] = [
        'Validate the main expected behavior with representative input.',
        'Cover invalid or unexpected input values.',
        'Verify edge cases such as empty values, null-like values, or missing configuration.',
        'Confirm error handling and fallback behavior.',
    ];

    if (/async|await|Promise/.test(content)) {
        suggestedCases.push('Verify asynchronous flows, resolved values, and rejected promises.');
    }

    if (/throw|catch|Error/.test(content)) {
        suggestedCases.push('Assert thrown errors and error messages when failure conditions occur.');
    }

    if (/class\s+|constructor\s*\(/.test(content)) {
        suggestedCases.push('Test class instantiation and public method behavior.');
    }

    if (/function\s+|=>/.test(content)) {
        suggestedCases.push('Test each exported function with nominal and edge-case scenarios.');
    }

    return suggestedCases;
}

function buildJsTsTemplate(filePath: string, summary: FileSummary, content: string, pathManager: TyrContext['path']): string {
    const sourceBaseName: string = pathManager.basename(filePath);
    const suggestedCases: string[] = buildSuggestedCases(content);
    const describeName: string = sourceBaseName.replace(/[`\\]/g, '\\$&');

    return `/**
 * Auto-generated test template.
 * Source file: ${summary.relativeSourcePath}
 * Extension: ${summary.extension || '(none)'}
 * Lines: ${summary.lineCount}
 * Approximate size: ${summary.sizeBytes} bytes (${summary.sizeApproxKb} KB)
 *
 * Review and complete this file manually before using it in CI.
 */

describe('${describeName}', () => {
    it('should implement the main expected behavior', () => {
        // TODO: Import the module under test.
        // TODO: Arrange the required input data and dependencies.
        // TODO: Execute the behavior being tested.
        // TODO: Assert the expected result.
    });

    it('should handle invalid or edge-case input', () => {
        // TODO: Add assertions for invalid values, empty input, and boundary conditions.
    });

    it('should document current behavior for regressions', () => {
        // TODO: Add regression-focused assertions for the most important paths.
    });
});

/*
Suggested test cases:
${suggestedCases.map((testCase: string) => `- ${testCase}`).join('\n')}

TODO:
- Replace placeholder imports with the real module path.
- Add mocks, stubs, or fixtures if the source depends on external services or filesystem access.
- Verify exported functions, classes, or side effects individually.
- Remove or adapt any placeholder test blocks that do not apply.
*/
`;
}

function buildGenericTemplate(summary: FileSummary, content: string): string {
    const suggestedCases: string[] = buildSuggestedCases(content);

    return `# Auto-generated test template

Source file: ${summary.relativeSourcePath}
Extension: ${summary.extension || '(none)'}
Lines: ${summary.lineCount}
Approximate size: ${summary.sizeBytes} bytes (${summary.sizeApproxKb} KB)

This file was generated automatically as a generic testing guide.
Review the source file and adapt these notes to the testing framework or validation process used by that language or toolchain.

Suggested test cases:
${suggestedCases.map((testCase: string, index: number) => `${index + 1}. ${testCase}`).join('\n')}

TODO:
- Identify the public behaviors, commands, functions, or outputs that should be verified.
- Define the execution environment required to run tests for this language.
- Add fixtures, sample inputs, and expected outputs.
- Cover success paths, failure paths, and edge cases.
- Convert this template into executable tests if the target ecosystem supports them.
`;
}

export default ({ fail, logger, fs, path }: TyrContext) => {
    return async (args: string[]) => {
        logger.info('Running command: ai:test');

        try {
            const inputPathArg: string | undefined = args[0];

            if (!inputPathArg) {
                fail('You must provide the path to a source file.', 'Usage: tyr ai:test <file>');
            }

            const sourceFilePath: string = path.resolve(process.cwd(), inputPathArg as string);
            logger.info(`Source file received: ${sourceFilePath}`);

            if (!fs.exists(sourceFilePath)) {
                fail(`Source file does not exist: ${sourceFilePath}`, 'Check the given path and try again.');
            }

            const sourceContent = await fs.read(sourceFilePath);
            const normalizedContent: string = typeof sourceContent === 'string' ? sourceContent : String(sourceContent ?? '');

            logger.info('Source file found, reading content...');
            const summary: FileSummary = buildFileSummary(sourceFilePath, normalizedContent, path);
            const testFilePath: string = getTestFilePath(sourceFilePath, path);
            const extension: string = path.extname(sourceFilePath).toLowerCase();

            logger.info(`Generating test template for extension: ${extension || '(none)'}`);

            const testContent: string = JS_TS_EXTENSIONS.has(extension)
                ? buildJsTsTemplate(sourceFilePath, summary, normalizedContent, path)
                : buildGenericTemplate(summary, normalizedContent);

            await fs.write(testFilePath, testContent);

            logger.info(`Test template written to: ${testFilePath}`);
            logger.success(`Command ai:test finished! Generated: ${testFilePath}`);
        } catch (error: unknown) {
            const message: string = error instanceof Error ? error.message : 'Unknown error';
            fail(`Failed to generate the test template: ${message}`);
        }
    };
};

export const Test = { args: ['file'] };
