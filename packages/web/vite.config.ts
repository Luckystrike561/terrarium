import { defineConfig } from "vite";
import { terrariumIcons } from "./build/icons.ts";

const hub = process.env.TERRARIUM_HUB_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
	plugins: [terrariumIcons()],
	server: {
		host: process.env.TERRARIUM_WEB_HOST ?? "127.0.0.1",
		proxy: {
			"/view": { target: hub, ws: true },
		},
	},
	build: {
		target: "es2022",
	},
});
