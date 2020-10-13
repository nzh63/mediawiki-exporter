import _axios, { AxiosRequestConfig, CancelTokenSource } from 'axios';
import http from 'http';
import https from 'https';
import { HTTP_TIMEOUT, USER_AGENT } from './config';

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

let sources: CancelTokenSource[] = [];
axios.interceptors.request.use(config => {
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