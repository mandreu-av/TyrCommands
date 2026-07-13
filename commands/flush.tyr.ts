import type { TyrContext } from '@tyrframework/cli';

/**
 * @description Limpia la caché de SCSS en el compilador de Avantio.
 * Si se pasa un keyword, limpia únicamente ese broker.
 * Sin argumentos, lanza un flush global.
 * @example
 * tyr flush
 * tyr flush <keyword_broker>
 */
export default ({ fail, logger, web }: TyrContext) => {
    return async (args: string[]) => {
        const keyword = args[0] ?? null;

        const baseUrl = 'https://fw-scss-compiler.avantio.pro/v1/flush/flush';
        const url = keyword
            ? `${baseUrl}?keyword=${encodeURIComponent(keyword)}`
            : baseUrl;

        const headers = {
            'authority': 'fw-scss-compiler.avantio.pro',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'es-ES,es;q=0.9,en;q=0.8,ca;q=0.7',
            'cache-control': 'max-age=0',
            'referer': 'https://avantio.atlassian.net/',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };

        logger.info(keyword ? `Limpiando caché para: ${keyword}` : 'Lanzando flush global...');

        try {
            const data = await web.get(url, { headers });

            if (data?.ok) {
                logger.success('¡Broker limpiado!');
            } else {
                logger.info('Respuesta del servidor:');
                console.log(data);
            }
        } catch (error: any) {
            const status = error?.status ?? error?.originalError?.response?.status;

            if (status === 404) {
                logger.info('No se ha encontrado nada que limpiar en este broker.');
            } else if (status === 304) {
                logger.info('Este broker ya está limpio.');
            } else {
                fail(
                    `Error al hacer flush (HTTP ${status ?? 'desconocido'})`,
                    'Comprueba tu conexión y que el servidor del compilador SCSS está disponible.'
                );
            }
        }
    };
};

export const Test = { args: [] };
