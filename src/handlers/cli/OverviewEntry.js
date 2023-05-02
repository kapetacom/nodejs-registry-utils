const Box = require('blessed/lib/widgets/box');
const Text = require('blessed/lib/widgets/text');

class OverviewEntry extends Box {
    constructor(options) {
        super(options);

        this._timer = null;

        this.type = 'overview-entry';

        this._text = new Text({
            parent: this,
            top: 0,
            left: 0,
            right: 3,
            height: 1,
            tags: true,
            content: '',
        });

        this._icon = new Text({
            parent: this,
            top: 0,
            width: 1,
            right: 0,
            height: 1,
            content: '|',
            bold: true,
            tags: true,
            fg: 'blue',
        });
    }

    value(text) {
        this._text.setContent(text);
        this._icon.hide();
    }

    start(text) {
        this._text.setContent(text);

        this._timer = setInterval(() => {
            if (this._icon.content === '|') {
                this._icon.setContent('/');
            } else if (this._icon.content === '/') {
                this._icon.setContent('-');
            } else if (this._icon.content === '-') {
                this._icon.setContent('\\');
            } else if (this._icon.content === '\\') {
                this._icon.setContent('|');
            }
            this.screen.render();
        }, 200);
    }

    end(ok) {
        clearInterval(this._timer);

        this._icon.setContent(ok ? '{green-fg}✓{/}' : '{red-fg}✖{/}');

        this.screen.render();
    }
}

module.exports = OverviewEntry;
