import path from 'path';
import type { TyrContext } from '@tyrframework/cli';

/**
 * @description Genera una nueva web v8 a partir de la plantilla framework-template.git.
 * Crea la estructura de directorios, inicializa el repositorio git y opcionalmente
 * configura las landings del configWeb.php.
 * @example
 * tyr nw <nombre_ftp>
 */
export default ({ task, fail, logger, shell, fs, git, workspace }: TyrContext) => {
    return async (args: string[]) => {
        const repoName = args[0];

        if (!repoName) {
            fail(
                'Falta el argumento: nombre FTP de la nueva web.',
                'Uso: tyr nueva-web <nombre_ftp>'
            );
        }

        const gitRoot = process.env.GIT_ROOT;
        const gitBase = process.env.GIT_BASE;
        const websDir = process.env.WEBS_DIR;
        const integrationsDir = process.env.INTEGRATIONS_DIR;

        if (!gitRoot) fail('La variable GIT_ROOT no está configurada en ~/.tyr/.env');
        if (!gitBase) fail('La variable GIT_BASE no está configurada en ~/.tyr/.env');
        if (!websDir) fail('La variable WEBS_DIR no está configurada en ~/.tyr/.env');
        if (!integrationsDir) fail('La variable INTEGRATIONS_DIR no está configurada en ~/.tyr/.env');

        const templateRepo = `${gitRoot}/framework-template.git`;
        const repoDir = path.join(websDir!, repoName);
        const htdocsDir = path.join(repoDir, 'htdocs');
        const brokerName = `bk_${repoName}`;
        const brokerDir = path.join(integrationsDir!, brokerName);
        const sitemapsDir = path.join(htdocsDir, 'web-sitemap');
        const configWebFile = path.join(htdocsDir, 'config', 'configWeb.php');
        const sitemapFile = path.join(sitemapsDir, 'sitemap.xml');
        const remoteUrl = `${gitBase}/${repoName}.git`;

        await task(`Clonando plantilla framework-template en ${repoName}/htdocs`, async () => {
            await git.cloneTo(templateRepo, htdocsDir);
        });

        // Solucion entorno Avantio
        await task('Eliminando el .git de la plantilla', async () => {
            await shell.exec(`rm -rf "${path.join(htdocsDir, '.git')}"`);
            await shell.exec(`rm -rf "${path.join(htdocsDir, '.gitignore')}"`);
        });
        // Solucion entorno Avantio
        await task('Creando repositorio Git para la nueva web', async () => {
            await shell.exec(`echo "\n.DS_Store" >> "${path.join(repoDir, '.gitignore')}"`);
        });

        await task('Inicializando repositorio Git', async () => {
            await git.initWithRemote(repoDir, remoteUrl);
        });

        await task('Aplicando permisos', async () => {
            await shell.exec(`chmod -R 777 "${repoDir}"`);
        });

        await task(`Creando carpeta de integración ${brokerName}`, async () => {
            const onlineDir = path.join(htdocsDir, 'online');
            if (fs.exists(onlineDir)) {
                await fs.createDir(brokerDir);
                await shell.exec(`cp -R "${onlineDir}/." "${brokerDir}/"`);
                logger.info(`Carpeta online/ copiada a ${brokerDir}`);
            } else {
                logger.warn('No se encontró la carpeta online/ en la plantilla. Saltando copia.');
            }
        });

        await task('Creando estructura de sitemaps', async () => {
            await fs.createDir(sitemapsDir);
            await shell.exec(`touch "${sitemapFile}"`);
        });

        logger.success('¡La estructura de la web está creada!');

        const configureLandings = await shell.confirm(
            '¿Quieres configurar las landings en el configWeb.php ahora?',
            false
        );

        if (configureLandings) {
            await task('Configurando landings', async () => {
                const frameworkDir = process.env.FRAMEWORK_DIR;
                const widgetsDir = frameworkDir
                    ? path.join(frameworkDir, 'components', 'core-8.0.0', 'includes', 'gadgets')
                    : null;

                if (!widgetsDir || !fs.exists(widgetsDir)) {
                    logger.warn('No se encontró el directorio de widgets (FRAMEWORK_DIR no configurado o incorrecto).');
                    logger.info('Puedes configurar las landings manualmente en: ' + configWebFile);
                    return;
                }

                const configWebContent = await fs.read(configWebFile);
                if (!configWebContent) {
                    logger.warn('No se encontró el archivo configWeb.php en la plantilla.');
                    return;
                }

                const landingConf = await buildLandingsConfig(shell, widgetsDir, fs);
                const updated = configWebContent.replace(
                    /\/\/ COPIAR LOS BLOQUES DE LA VERSI[^\n]*/,
                    landingConf
                );

                await shell.exec(`cp "${configWebFile}" "${configWebFile}.bak"`);
                await fs.write(configWebFile, updated);

                logger.success('configWeb.php actualizado con las landings.');
                logger.warn('Recuerda añadir en los archivos de idiomas las nuevas landings creadas.');
            });
        }

        await workspace.tagWorkspace(repoDir, null, true);

        logger.success(`¡Web '${repoName}' creada con éxito!`);
        logger.info('Próximos pasos: instalar la web y añadirla a los hosts.');
    };
};


async function getAvailableWidgets(
    widgetsDir: string,
    landing: string,
    shell: any,
    fs: any
): Promise<string[]> {
    let landSubdir = 'main';
    if (landing.toLowerCase() === 'footer') landSubdir = 'footer';
    if (landing.toLowerCase() === 'header') landSubdir = 'header';

    const targetDir = path.join(widgetsDir, landSubdir);
    if (!fs.exists(targetDir)) return [];

    const result = await shell.exec(`ls "${targetDir}"`);
    return result.split('\n').map((s: string) => s.trim()).filter(Boolean);
}

function buildWidgetBlock(widgets: string[], landing: string): string {
    const landName = `$i18n${landing}`;
    return widgets.map((widget, idx) => `
$GLOBALS['bloque'][${landName}][${idx}]['container']['layoutFullSize'] = array(
  //${widget} => 1
  '${widget}' => 1
);`).join('\n');
}

async function buildLandingsConfig(shell: any, widgetsDir: string, fs: any): Promise<string> {
    const blocks: string[] = [];

    // Landing principal (Inicio)
    const mainWidgets = await getAvailableWidgets(widgetsDir, 'main', shell, fs);
    if (mainWidgets.length > 0) {
        const selected = await shell.checkbox(
            mainWidgets.map((w: string) => ({ name: w, value: w })),
            'Widgets para la landing de Inicio:'
        );
        blocks.push(`/****  LANDING INICIO  ****/`);
        blocks.push(buildWidgetBlock(selected, 'Inicio'));
    }

    // Landings adicionales
    const numStr = await shell.input('¿Cuántas landings adicionales tiene la web? (0 para ninguna):');
    const numLandings = parseInt(numStr, 10) || 0;

    for (let i = 0; i < numLandings; i++) {
        const landingName = await shell.input(`Nombre de la landing ${i + 1}:`);
        const widgets = await getAvailableWidgets(widgetsDir, landingName, shell, fs);

        if (widgets.length > 0) {
            const selected = await shell.checkbox(
                widgets.map((w: string) => ({ name: w, value: w })),
                `Widgets para la landing '${landingName}':`
            );
            blocks.push(`/****  LANDING ${landingName.toUpperCase()}  ****/`);
            blocks.push(buildWidgetBlock(selected, landingName));
        } else {
            blocks.push(`/****  LANDING ${landingName.toUpperCase()}  ****/`);
            blocks.push(`// No se encontraron widgets para '${landingName}'`);
        }
    }

    return blocks.join('\n');
}

export const Test = { args: [] };
