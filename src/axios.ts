import _axios, { AxiosRequestConfig, CancelTokenSource } from 'axios';
import http from 'http';
import https from 'https';
import { MAX_REQUEST_PRE_SECOND, HTTP_TIMEOUT, USER_AGENT } from './config';


const axios = _axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: HTTP_TIMEOUT,
    headers: {
        'Accept-Encoding': 'gzip',
        Connection: 'keep-alive',
        'User-Agent': USER_AGENT
    }
});

let tokens = MAX_REQUEST_PRE_SECOND;
let lastDate = new Date().getTime();
function addToken() {
    tokens += (new Date().getTime() - lastDate) * MAX_REQUEST_PRE_SECOND / 1000;
    tokens = Math.min(tokens, 4 * MAX_REQUEST_PRE_SECOND);
    lastDate = new Date().getTime();
}
axios.interceptors.request.use(async config => {
    while (tokens < 1 && MAX_REQUEST_PRE_SECOND > 0) {
        addToken();
        if (tokens < 1) {
            await new Promise(resolve => {
                setTimeout(() => {
                    addToken();
                    resolve();
                }, 1000 / MAX_REQUEST_PRE_SECOND);
            });
        }
    }
    tokens--;
    return config;
});

let sources: CancelTokenSource[] = [];
axios.interceptors.request.use(async config => {
    if (!config.cancelToken) {
        const source = _axios.CancelToken.source();
        config.cancelToken = source.token;
        sources.push(source);
    }
    return config;
});

axios.interceptors.response.use(
    resp => {
        if (resp.config.cancelToken) {
            sources = sources.filter(i => i.token !== resp.config.cancelToken);
        }
        return resp;
    },
    error => {
        if (error.config) {
            const config = error.config as AxiosRequestConfig;
            if (config.cancelToken) {
                sources = sources.filter(i => i.token !== config.cancelToken);
            }
        }
        return Promise.reject(error);
    }
);

export function cancelRequest(): void {
    sources.forEach(i => i.cancel());
    sources = [];
}

export default axios;