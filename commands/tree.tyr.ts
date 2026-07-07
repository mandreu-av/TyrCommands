import fs from 'fs';
import path from 'path';
import type { TyrContext } from '@orxataguy/tyr';

/**
 *
 * Genera un árbol visual legible de archivos y carpetas del directorio actual
 * (o del directorio indicado como argumento).
 *
 * Uso:
 *   tyr tree
 *   tyr tree <directorio>
 */

const IGNORE = new Set(['.DS_Store', '.git', '.next', '.gitignore', 'node_modules', 'vendor', 'dist', '.cache']);

const MAGENTA = '\x1b[35m';
const CYAN    = '\x1b[36m';
const RESET   = '\x1b[0m';

interface TreeNode {
    [name: string]: TreeNode | null;
}

function buildTree(dir: string, depth: number = 0, maxDepth: number = 10): TreeNode {
    if (depth >= maxDepth) return {};

    const tree: TreeNode = {};
    let entries: fs.Dirent[];

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return tree;
    }

    entries.sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
        return a.isDirectory() ? -1 : 1;
    });

    for (const entry of entries) {
        if (IGNORE.has(entry.name) || entry.name.startsWith('.')) {
            continue;
        }

        if (entry.isDirectory()) {
            tree[entry.name] = buildTree(path.join(dir, entry.name), depth + 1, maxDepth);
        } else {
            tree[entry.name] = null;
        }
    }

    return tree;
}

function renderTree(tree: TreeNode, prefix: string = ''): void {
    const entries = Object.entries(tree);

    entries.forEach(([name, children], index) => {
        const isLast = index === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const colour = children !== null ? MAGENTA : CYAN;

        console.log(`${prefix}${connector}${colour}${name}${RESET}`);

        if (children !== null) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            renderTree(children, newPrefix);
        }
    });
}

export default ({ fail, logger }: TyrContext) => {
    return async (args: string[]) => {
        const targetDir = args[0]
            ? path.resolve(process.cwd(), args[0])
            : process.cwd();

        if (!fs.existsSync(targetDir)) {
            fail(`El directorio no existe: ${targetDir}`);
        }

        const stat = fs.statSync(targetDir);
        if (!stat.isDirectory()) {
            fail(`La ruta no es un directorio: ${targetDir}`);
        }

        logger.info(`${MAGENTA}${targetDir}${RESET}`);

        const tree = buildTree(targetDir);

        if (Object.keys(tree).length === 0) {
            logger.info('(directorio vacío)');
            return;
        }

        renderTree(tree);
    };
};

export const Test = { args: [] };
