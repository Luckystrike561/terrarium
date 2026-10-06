/** Fixed-capacity FIFO; pushing into a full ring overwrites the oldest item. */
export class RingBuffer<T> {
	readonly capacity: number;
	readonly #items: (T | undefined)[];
	#head = 0;
	#size = 0;

	constructor(capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError(
				`ring capacity must be a positive integer, got ${capacity}`,
			);
		}
		this.capacity = capacity;
		this.#items = new Array<T | undefined>(capacity);
	}

	get size(): number {
		return this.#size;
	}

	/** Returns true when the oldest item was overwritten to make room. */
	push(item: T): boolean {
		const tail = (this.#head + this.#size) % this.capacity;
		this.#items[tail] = item;
		if (this.#size < this.capacity) {
			this.#size++;
			return false;
		}
		this.#head = (this.#head + 1) % this.capacity;
		return true;
	}

	/** Removes and returns every item, oldest first. */
	drain(): T[] {
		const out: T[] = [];
		for (let i = 0; i < this.#size; i++) {
			const index = (this.#head + i) % this.capacity;
			out.push(this.#items[index] as T);
			this.#items[index] = undefined;
		}
		this.#head = 0;
		this.#size = 0;
		return out;
	}
}
