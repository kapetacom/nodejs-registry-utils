const DockerHandler = require("./handlers/artifact-handlers/DockerHandler");
const NPMHandler = require("./handlers/artifact-handlers/NPMHandler");
const MavenHandler = require("./handlers/artifact-handlers/MavenHandler");
const YAMLHandler = require("./handlers/artifact-handlers/YAMLHandler");

module.exports = {
    Config: require('./config'),
    RegistryService: require('./services/RegistryService'),
    DockerService: require('./services/DockerService'),
    ArtifactHandler: require('./handlers/ArtifactHandler'),
    VCSHandler: require('./handlers/VCSHandler'),
    PushOperation: require('./actions/PushOperation'),
    Actions: {
        install: require('./actions/install'),
        uninstall: require('./actions/uninstall'),
        push: require('./actions/push'),
        clone: require('./actions/clone'),
        link: require('./actions/link'),
        view: require('./actions/view')
    },
    vcs: {
        GitHandler: require('./handlers/vcs-handlers/GitHandler'),
    },
    handlers: {
        DockerHandler,
        NPMHandler,
        MavenHandler,
        YAMLHandler
    }
}