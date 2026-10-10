import { App, FuzzyMatch, FuzzySuggestModal, Notice, SuggestModal, TFile } from 'obsidian';

export interface LinkItem {
    file?: TFile;
    createTitle?: string;
    folderPath?: string;
}

/**
 * Native Obsidian SuggestModal to link canvas strokes to vault notes.
 * Searches across app.vault.getMarkdownFiles() and provides a "Crear nota «texto»"
 * option when no exact match exists.
 */
export class LinkSuggestModal extends SuggestModal<LinkItem> {
    private readonly onChoose: (targetNoteName: string) => void;

    constructor(app: App, onChoose: (targetNoteName: string) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder('Buscar o crear nota para enlazar selección...');
        this.emptyStateText = 'No se encontraron notas en el vault.';
    }

    getSuggestions(query: string): LinkItem[] {
        const q = query.trim().toLowerCase();
        const files = this.app.vault.getMarkdownFiles();

        const filtered = q
            ? files.filter(f => f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
            : files;

        // Sort: exact matches first, then prefix matches, then alphabetical
        filtered.sort((a, b) => {
            const aName = a.basename.toLowerCase();
            const bName = b.basename.toLowerCase();
            if (q) {
                if (aName === q) return -1;
                if (bName === q) return 1;
                const aStarts = aName.startsWith(q);
                const bStarts = bName.startsWith(q);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
            }
            return a.basename.localeCompare(b.basename);
        });

        const items: LinkItem[] = filtered.slice(0, 30).map(file => ({
            file,
            folderPath: file.parent && file.parent.path !== '/' ? file.parent.path : '',
        }));

        // If the query is non-empty and doesn't exactly match an existing note basename:
        if (query.trim() && !files.some(f => f.basename.toLowerCase() === q)) {
            items.push({
                createTitle: query.trim(),
            });
        }

        return items;
    }

    renderSuggestion(item: LinkItem, el: HTMLElement): void {
        el.empty();
        el.classList.add('apolo-link-suggestion-item');

        if (item.file) {
            const titleEl = el.createDiv({ cls: 'apolo-suggest-title', text: item.file.basename });
            titleEl.style.fontWeight = '600';
            titleEl.style.color = 'var(--text-normal)';

            if (item.folderPath) {
                const folderEl = el.createDiv({ cls: 'apolo-suggest-folder', text: item.folderPath });
                folderEl.style.fontSize = '12px';
                folderEl.style.color = 'var(--text-muted)';
            }
        } else if (item.createTitle) {
            const titleEl = el.createDiv({
                cls: 'apolo-suggest-title is-create',
                text: `Crear nota «${item.createTitle}»`,
            });
            titleEl.style.fontWeight = '600';
            titleEl.style.color = 'var(--interactive-accent)';

            const descEl = el.createDiv({
                cls: 'apolo-suggest-folder',
                text: 'Nueva nota en la raíz del vault',
            });
            descEl.style.fontSize = '12px';
            descEl.style.color = 'var(--text-muted)';
        }
    }

    async onChooseSuggestion(item: LinkItem, evt: MouseEvent | KeyboardEvent): Promise<void> {
        if (item.file) {
            this.onChoose(item.file.basename);
            return;
        }

        if (item.createTitle) {
            const fileName = item.createTitle.endsWith('.md') ? item.createTitle : `${item.createTitle}.md`;
            try {
                const newFile = await this.app.vault.create(fileName, '');
                new Notice(`Nota creada: [[${newFile.basename}]]`);
                this.onChoose(newFile.basename);
            } catch (err) {
                console.warn('[ApoloCanvas] Could not create note, linking by name:', err);
                this.onChoose(item.createTitle);
            }
        }
    }
}

/**
 * Triggers native Obsidian local graph command.
 */
export function openLocalGraph(app: App): void {
    // TODO: Integrate stroke links into app.metadataCache.resolvedLinks / unresolvedLinks
    // so that ink links appear as native graph nodes and edges.
    const commandId = 'graph:open-local';
    const appWithCommands = app as unknown as { commands?: { executeCommandById: (id: string) => boolean } };
    if (appWithCommands.commands?.executeCommandById(commandId)) {
        return;
    }
    const commands = (app as unknown as { commands?: { commands: Record<string, unknown>; executeCommand: (cmd: unknown) => void } }).commands;
    if (commands?.commands && commands.commands[commandId]) {
        commands.executeCommand(commands.commands[commandId]);
    } else {
        new Notice('Apolo Canvas: El comando de grafo local no está disponible en este espacio de trabajo.');
    }
}
