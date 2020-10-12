export const API_URL = process.env.API_URL || 'https://www.mediawiki.org/w/api.php';
export const MAX_WORKERS = parseInt(process.env.MAX_WORKERS ?? '') || 4;
export const MAX_RETRY = parseInt(process.env.MAX_RETRY ?? '') || 3;
export const HTTP_TIMEOUT = parseInt(process.env.HTTP_TIMEOUT ?? '') || 30 * 1000;
export const TITLE_BLACK_LIST = [];
export const USER_AGENT = process.env.USER_AGENT ?? 'nzh63-bot';
