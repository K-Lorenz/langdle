/**
 * Einfache Fortschrittsanzeige für CLI-Seeds (TTY: eine Zeile mit Balken; sonst Zeilen-Logs).
 */

export type SeedProgressReporter = {
	/** Fortschritt 0–100 mit Kurzbeschreibung (TTY: überschreibt eine Zeile). */
	set(percent: number, detail: string): void;
	/** Volle Zeile ausgeben (mit Zeilenumbruch). */
	log(line: string): void;
	/** Am Ende aufrufen: TTY-Zeile abschließen. */
	done(): void;
};

const BAR_W = 26;

/** `silent`: keine Balken-Zeilen (z. B. `SEED_QUIET=1`). */
export function createSeedProgress(prefix = '[seed]', silent = false): SeedProgressReporter {
	if (silent) {
		return {
			set: () => {},
			log: () => {},
			done: () => {}
		};
	}

	const tty = process.stdout.isTTY === true;
	let lastVisualLen = 0;

	function render(percent: number, detail: string): void {
		const p = Math.max(0, Math.min(100, percent));
		const filled = Math.round((p / 100) * BAR_W);
		const bar = '█'.repeat(filled) + '░'.repeat(BAR_W - filled);
		const text = `${prefix} [${bar}] ${p.toFixed(0).padStart(3)}% ${detail}`;
		if (tty) {
			const pad = Math.max(0, lastVisualLen - text.length);
			process.stdout.write(`\r${text}${' '.repeat(pad)}`);
			lastVisualLen = text.length;
		} else {
			console.log(text);
		}
	}

	return {
		set: render,
		log(line: string) {
			if (tty && lastVisualLen > 0) {
				process.stdout.write('\n');
				lastVisualLen = 0;
			}
			console.log(`${prefix} ${line}`);
		},
		done() {
			if (tty && lastVisualLen > 0) {
				process.stdout.write('\n');
				lastVisualLen = 0;
			}
		}
	};
}
