/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const FS = require('fs');
const YAML = require('yaml');
const ClusterConfiguration = require('@kapeta/local-cluster-config').default;

const BASEDIR_KAPETA = ClusterConfiguration.getKapetaBasedir();

let CONFIG_FILE = BASEDIR_KAPETA + '/registry.yml';

const REGISTRY_CONFIG_FILES = [
    CONFIG_FILE,
    BASEDIR_KAPETA + '/registry.yaml',
    BASEDIR_KAPETA + '/registry.json'
];

class ConfigWrapper {
    constructor() {
        this.data = require('./config.default');
    }
    save() {
        if (CONFIG_FILE.endsWith('.json')) {
            FS.writeFileSync(CONFIG_FILE,  JSON.stringify(this.data, null, 2));
        } else {
            FS.writeFileSync(CONFIG_FILE,  YAML.stringify(this.data, null, 2));
        }
    }
}

const config = new ConfigWrapper();

for(let i = 0 ; i < REGISTRY_CONFIG_FILES.length; i++) {
    const filePath = REGISTRY_CONFIG_FILES[i];
    if (FS.existsSync(filePath)) {
        const content = FS.readFileSync(filePath).toString();
        if (filePath.endsWith('.json')) {
            Object.assign(config.data, JSON.parse(content));
        } else {
            Object.assign(config.data, YAML.parse(content));
        }

        CONFIG_FILE = filePath;
        break;
    }
}

module.exports = config;

