/**
 * The one Godot release every web export is built with. Bumping it means
 * updating every hash below and re-running `npm run godot:export`.
 */
const VERSION = '4.7.2-stable';
const RELEASE_URL = `https://github.com/godotengine/godot-builds/releases/download/${VERSION}`;

export const GODOT = {
  version: VERSION,
  /** The directory name Godot looks for templates under (`4.7.2.stable`). */
  templatesDirName: VERSION.replace('-', '.'),
  /** Headless-capable editor per `${process.platform}-${process.arch}`, SHA-512 from the release's SHA512-SUMS.txt. */
  editors: {
    'linux-x64': {
      url: `${RELEASE_URL}/Godot_v${VERSION}_linux.x86_64.zip`,
      sha512:
        '9aa00f7a605200940bce3027a567b782f49bd8e940dd06ae9e987bd65aee1b1467edd56ed84fcdcbdd44354bf613bdbb4e5d2913e925850368e150c59ed54c65',
      binary: `Godot_v${VERSION}_linux.x86_64`,
    },
    'linux-arm64': {
      url: `${RELEASE_URL}/Godot_v${VERSION}_linux.arm64.zip`,
      sha512:
        'dd59918da086bd49bde2f5450b5e567ff8650cbde9abbd7b8f4ca1197ff8c609baa38834666d032deafb47099078d7822279e2a0e06e5665745468f26533e7e2',
      binary: `Godot_v${VERSION}_linux.arm64`,
    },
  },
  /**
   * The templates archive is over 1 GB, so only the members below are read
   * from it, by HTTP range. Their SHA-256 was taken from a full download
   * whose SHA-512 matched the release's SHA512-SUMS.txt.
   */
  templates: {
    url: `${RELEASE_URL}/Godot_v${VERSION}_export_templates.tpz`,
    members: {
      'templates/web_nothreads_release.zip':
        'd3ee2f08cef0cf3cf6678a6355a92a8db48ccdd35cbd2e8bfd5f0e8a0b4032a0',
    },
  },
};
