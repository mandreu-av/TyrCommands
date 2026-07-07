import type { TyrContext } from '@orxataguy/tyr';

const MAX_SLAB = 42;

/**
 *
 * Busca una clave de memcache del tipo proc_getconfig y la elimina.
 *
 * Uso:
 *   tyr remcache <broker> <idioma> <key> <separador>
 *   tyr remcache bk_horizonenterpri it
 */
export default ({ fail, logger, web }: TyrContext) => {
    return async (args: string[]) => {
        const param1 = args[0] ?? "'bk_horizonenterpri'";
        const param2 = args[1] ?? 'it';
        const param3 = args[2] ?? 'proc_getconfig';
        const param4 = args[3] ?? '_';

        const searchKey = `${param3}${param4}${param1}${param4}${param2}_utf8`;

        logger.info(`Buscando: ${searchKey}`);

        const escapeRegex = (str: string) =>
            str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        for (let slab = MAX_SLAB; slab >= 1; slab--) {
            const url = `http://wsadmin.avantio.com/memcache_gui/memcache.php?&op=2&server=0&dumpslab=${slab}`;
            logger.info(`Buscando en slab ${slab}...`);

            try {
                const html = await web.get(url, { responseType: 'text' });
                const regex = new RegExp(
                    `<a\\s+href="([^"]*)"[^>]*>\\s*${escapeRegex(searchKey)}\\s*</a>`,
                    'i'
                );
                const match = (html as string).match(regex);

                if (match) {
                    const href = match[1].replace(/&amp;/g, '&');
                    const fullUrl = `http://wsadmin.avantio.com${href}`;
                    logger.success(`Encontrado en slab ${slab}!`);
                    logger.info(`Enlace: ${fullUrl}`);
                    return;
                }
            } catch (error: any) {
                logger.info(`Error en slab ${slab}: ${error?.message ?? 'desconocido'}`);
            }
        }

        fail(
            `No se encontró la clave "${searchKey}" en ningún slab.`,
            'Comprueba que los parámetros son correctos y que wsadmin está accesible.'
        );
    };
};

export const Test = { args: ['bk_horizonenterpri', 'it'] };
