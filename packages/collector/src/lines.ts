export class LineReader {
	#buffer = "";

	push(chunk: string, onLine: (line: string) => void): void {
		this.#buffer += chunk;
		let newline = this.#buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line.length > 0) onLine(line);
			newline = this.#buffer.indexOf("\n");
		}
	}

	get pending(): number {
		return this.#buffer.length;
	}
}
