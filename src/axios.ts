import _axios from 'axios';
import http from 'http';
import https from 'https';
import { HTTP_TIMEOUT, USER_AGENT } from './config';

const source = _axios.CancelToken.source();
const axios = _axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    cancelToken: source.token,
    timeout: HTTP_TIMEOUT,
    headers: {
        'Accept-Encoding': 'gzip',
        Connection: 'keep-alive',
        'User-Agent': USER_AGENT
    }
});

export function cancelRequest(): void {
    source.cancel();
}

export default axios;