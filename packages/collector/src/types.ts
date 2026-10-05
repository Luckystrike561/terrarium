import type { TerrariumEvent } from "@terrarium/protocol";

export type Emit = (event: TerrariumEvent) => void;

export type Log = (message: string) => void;

export type Source = {
	stop(): void;
};
