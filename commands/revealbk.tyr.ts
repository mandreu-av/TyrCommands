/**
 * @description TODO: describe what the "revealbk" command does.
 * @example
 * tyr revealbk
 */
import type { TyrContext } from '@tyrframework/cli';

export default ({ db }: TyrContext) => {
    return async (args: string[]) => {
        let urlString = args.shift()?.toString() || '';

        if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
            urlString = 'https://' + urlString;
        }
        let hostname = new URL(urlString).hostname;

        if (hostname.split('.').length < 3) {
            hostname = ['www', hostname].join('.');
        }

        const isWeb = hostname.startsWith('www') ||
            hostname.startsWith('horizon') ||
            hostname.startsWith('ambiance') ||
            hostname.startsWith('panorama') ||
            hostname.startsWith('flow') ||
            hostname.startsWith('avantio') ||
            hostname.startsWith('demo');

        const query = isWeb
            ? `SELECT basedir as BROKER from ftpUsers where CONCAT(prefijo, '.', dominio) = '${hostname}'`
            : `SELECT LOGIN_DS AS BROKER from CR_CANALVENTAS WHERE WEB_DS = '${hostname}'`;

        const result = await db.select(query);

        if (!result[0] || !result[0].BROKER) {
            throw new Error(`No broker found for ${hostname}`);
        }

        return result[0].BROKER as string;
    };
};

export const Test = { args: [] };