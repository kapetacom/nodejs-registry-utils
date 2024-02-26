import * as FS from 'fs';
import * as YAML from 'yaml';
import ClusterConfiguration from '@kapeta/local-cluster-config';

const BASEDIR_KAPETA: string = ClusterConfiguration.getKapetaBasedir();

let CONFIG_FILE: string = `${BASEDIR_KAPETA}/registry.yml`;

const REGISTRY_CONFIG_FILES: string[] = [
    CONFIG_FILE,
    `${BASEDIR_KAPETA}/registry.yaml`,
    `${BASEDIR_KAPETA}/registry.json`,
];

export class ConfigWrapper {
    public data: any;

    constructor() {
        this.data = require('./config.default');
    }

    public save(): void {
        if (CONFIG_FILE.endsWith('.json')) {
            FS.writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2));
        } else {
            FS.writeFileSync(CONFIG_FILE, YAML.stringify(this.data, null, 2));
        }
    }
}

const config: ConfigWrapper = new ConfigWrapper();

for (let i: number = 0; i < REGISTRY_CONFIG_FILES.length; i++) {
    const filePath: string = REGISTRY_CONFIG_FILES[i];
    if (FS.existsSync(filePath)) {
        const content: string = FS.readFileSync(filePath).toString();
        if (filePath.endsWith('.json')) {
            Object.assign(config.data, JSON.parse(content));
        } else {
            Object.assign(config.data, YAML.parse(content));
        }

        CONFIG_FILE = filePath;
        break;
    }
}

export default config;
