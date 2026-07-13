/**
 * @description Descarga una integración en el directorio de datos_broker.
 * Acepta el nombre del broker directamente o una URL (en cuyo caso busca el broker en la BD).
 * @example
 * tyr di <bk_broker>
 * tyr di <url_de_la_integracion>
 */

import type { TyrContext } from '@tyrframework/cli';

export default ({ task, run, path, fail, logger, shell, fs, git, db, workspace, jira }: TyrContext) => {
    return async (args: string[]) => {
        const input = args[0];

        if (!input) {
            fail(
                'Falta el argumento: nombre del broker o URL de la integración.',
                'Uso: tyr descarga-integracion <bk_broker|url>'
            );
        }

        const gitBase = process.env.GIT_BASE;
        const integrationsDir = process.env.INTEGRATIONS_DIR;

        if (!gitBase) fail('La variable GIT_BASE no está configurada en ~/.tyr/.env');
        if (!integrationsDir) fail('La variable INTEGRATIONS_DIR no está configurada en ~/.tyr/.env');

        let repoName: string;

        if (input.match(/^https?:\/\//)) {
            repoName = await task('Buscando broker en la base de datos', async () => {
                const broker = run('revealbk', [input]);
                logger.info(`Broker encontrado: ${broker}`);
                return broker;
            }) as string;
        } else {
            repoName = input;
            await task('Verificando que el repositorio existe', async () => {
                const repoUrl = `${gitBase}/${repoName}`;
                const exists = await git.checkRepoExists(repoUrl);
                if (!exists) {
                    fail(
                        `El repositorio '${repoName}' no existe o no es accesible.`,
                        'Comprueba que el nombre del broker es correcto y que tienes acceso al repositorio.'
                    );
                }
            });
        }

        const repoDir = path.join(integrationsDir!, repoName);
        const repoUrl = `${gitBase}/${repoName}`;

        const proceed = await workspace.checkExisting(repoDir, 'integración');
        if (!proceed) return;

        await task(`Clonando ${repoName}`, async () => {
            await git.cloneTo(repoUrl, repoDir);
        });

        await task('Aplicando permisos', async () => {
            await shell.exec(`chmod -R 777 "${repoDir}"`);
        });

        const branch = await jira.selectIssue();

        await workspace.tagWorkspace(repoDir, branch, true);

        logger.success(`¡Integración '${repoName}' descargada correctamente!`);
    };
};

export const Test = { args: [] };
