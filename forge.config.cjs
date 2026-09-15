const path = require('node:path');
const fs = require('node:fs');
const tools = process.env.KARAOKE_MEDIA_TOOLS_DIR;
module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Karaoke',
    icon: path.resolve(__dirname, 'assets/app'),
    executableName: 'Karaoke',
    win32metadata: { CompanyName: 'auto-karaoke-player', FileDescription: '本地唱片室 · Offline Karaoke', ProductName: 'Karaoke' },
    extraResource: tools ? [path.resolve(tools)] : [],
    ignore: file => !!file && !/^\/(?:dist|node_modules|package\.json|README\.md|docs)(?:\/|$)/.test(file),
    ...(process.platform === 'darwin' && process.env.APPLE_ID ? {
      osxSign: {}, osxNotarize: { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD, teamId: process.env.APPLE_TEAM_ID },
    } : {}),
  },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }],
  hooks: {
    generateAssets: async (_config, platform, arch) => {
      if (platform === 'darwin' && arch !== 'arm64') throw new Error('macOS builds support Apple Silicon (arm64) only.');
      if (!tools || path.basename(tools) !== 'media-tools') throw new Error('Set KARAOKE_MEDIA_TOOLS_DIR to a media-tools directory containing ffmpeg and ffprobe for the target platform.');
      const suffix = platform === 'win32' ? '.exe' : ''; 
      for (const name of ['ffmpeg', 'ffprobe']) fs.accessSync(path.join(tools, name + suffix), fs.constants.R_OK);
    },
  },
};
