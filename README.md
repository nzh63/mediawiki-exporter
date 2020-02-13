# mediawiki-exporter

mediawiki-exporter is a tool for to export wiki by using [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page). This should be useful if the wiki site disable [Special:Export](https://www.mediawiki.org/wiki/Help:Export#Using_'Special:Export').

## How to use

1. Install [node.js](https://nodejs.org) and [yarn](https://yarnpkg.com).
2. Clone this repo:
```bash
git clone https://github.com/nzh63/mediawiki-exporter.git
cd mediawiki-exporter
```
3. Install dependencies:
```bash
yarn
```
4. Edit [src/config.ts](./src/config.ts), change `API_URL` to the site you want to download (eg. `https://www.mediawiki.org/w/api.php`).
5. Bulid & run:
```bash
yarn build
yarn start
```

## License
MIT
