import path from 'path';
import type { TyrContext } from '@orxataguy/tyr';

/**
 *
 * Crea una nueva integración custom para el broker indicado.
 * Clona la plantilla plantilla-integracion-custom.git, inicializa el repositorio
 * apuntando al remoto correcto y lo vincula a un ticket de Jira.
 *
 * Uso:
 *   tyr nic <bk_broker>
 */
export default ({ task, fail, logger, shell, git, workspace, jira }: TyrContext) => {
    return async (args: string[]) => {
        const repoName = args[0];

        if (!repoName) {
            fail(
                'Falta el argumento: nombre del broker.',
                'Uso: tyr nueva-integracion-custom <bk_broker>'
            );
        }

        const gitRoot = process.env.GIT_ROOT;
        const gitBase = process.env.GIT_BASE;
        const integrationsDir = process.env.INTEGRATIONS_DIR;

        if (!gitRoot) fail('La variable GIT_ROOT no está configurada en ~/.tyr/.env');
        if (!gitBase) fail('La variable GIT_BASE no está configurada en ~/.tyr/.env');
        if (!integrationsDir) fail('La variable INTEGRATIONS_DIR no está configurada en ~/.tyr/.env');

        const templateRepo = `${gitRoot}/plantilla-integracion-custom.git`;
        const repoDir = path.join(integrationsDir!, repoName);
        const remoteUrl = `${gitBase}/${repoName}.git`;

        await task(`Clonando plantilla custom en ${repoName}`, async () => {
            await git.cloneTo(templateRepo, repoDir);
        });

        await task('Inicializando repositorio Git', async () => {
            await git.initWithRemote(repoDir, remoteUrl);
        });

        await task('Aplicando permisos', async () => {
            await shell.exec(`chmod -R 777 "${repoDir}"`);
        });

        const branch = await jira.selectIssue();

        await workspace.tagWorkspace(repoDir, branch, true);

        logger.success(`¡Integración custom '${repoName}' creada correctamente!`);
        logger.info('Recuerda hacer el primer commit y push cuando estés listo.');
    };
};

export const Test = { args: [] };
