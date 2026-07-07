import path from 'path';
import type { TyrContext } from '@orxataguy/tyr';

/**
 *
 * Descarga una web de clientes en el directorio de webs.
 * Acepta el nombre FTP directamente o una URL (en cuyo caso extrae el nombre
 * del meta tag "webname" o busca en la BD).
 *
 * Uso:
 *   tyr dw <nombre_ftp>
 *   tyr dw <url_de_la_web>
 */
export default ({ task, fail, logger, shell, git, web, db, workspace, jira }: TyrContext) => {
    return async (args: string[]) => {
        const input = args[0];

        if (!input) {
            fail(
                'Falta el argumento: nombre FTP o URL de la web.',
                'Uso: tyr descarga-web <nombre_ftp|url>'
            );
        }

        const gitBase = process.env.GIT_BASE;
        const websDir = process.env.WEBS_DIR;

        if (!gitBase) fail('La variable GIT_BASE no está configurada en ~/.tyr/.env');
        if (!websDir) fail('La variable WEBS_DIR no está configurada en ~/.tyr/.env');

        let repoName: string;

        if (input.match(/^https?:\/\//)) {
            repoName = await task('Resolviendo nombre de la web', async () => {
                const metaWebname = await web.getMetaTag(input, 'webname').catch(() => null);

                if (metaWebname) {
                    logger.info(`Nombre encontrado vía meta tag: ${metaWebname}`);
                    return metaWebname;
                }

                logger.info('Meta tag no encontrado, buscando en la base de datos...');
                const broker = await db.searchBrokerOnDB(input);
                logger.info(`Nombre encontrado en BD: ${broker}`);
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
                        'Comprueba que el nombre FTP es correcto y que tienes acceso al repositorio.'
                    );
                }
            });
        }

        const repoDir = path.join(websDir!, repoName);
        const repoUrl = `${gitBase}/${repoName}`;

        const proceed = await workspace.checkExisting(repoDir, 'web');
        if (!proceed) return;

        await task(`Clonando ${repoName}`, async () => {
            await git.cloneTo(repoUrl, repoDir);
        });

        await task('Aplicando permisos', async () => {
            await shell.exec(`chmod -R 777 "${repoDir}"`);
        });

        const branch = await jira.selectIssue();

        await workspace.tagWorkspace(repoDir, branch, true);

        logger.success(`¡Web '${repoName}' descargada correctamente!`);
    };
};

export const Test = { args: [] };
