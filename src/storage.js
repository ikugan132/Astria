'use strict';

const fs = require('node:fs');
const path = require('node:path');

function configureStorage(app, { execPath = process.execPath, env = process.env } = {}) {
  // Explicit test profiles always take precedence over portable mode.
  if (!app.isPackaged && env.MULTINEST_USER_DATA) {
    app.setPath('userData', env.MULTINEST_USER_DATA);
    return { portable: false };
  }
  if (app.commandLine?.hasSwitch('user-data-dir')) return { portable: false };

  const directory = path.dirname(execPath);
  if (!app.isPackaged || !fs.existsSync(path.join(directory, 'portable.flag'))) {
    app.setPath('userData', path.join(app.getPath('appData'), 'MultiNest'));
    return { portable: false };
  }

  const root = path.join(directory, 'Save');
  const profile = path.join(root, 'Profile');
  const games = path.join(root, 'Games');
  const backups = path.join(root, 'Backups');
  const logs = path.join(root, 'Logs');
  const crashes = path.join(root, 'CrashDumps');
  const temp = path.join(root, 'Temp');
  for (const folder of [profile, games, backups, logs, crashes, temp]) fs.mkdirSync(folder, { recursive: true });
  // Set before ready: Chromium storage, logs and downloads follow the executable.
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setPath('downloads', games);
  app.setPath('crashDumps', crashes);
  app.setPath('temp', temp);
  // Chromium child processes and libraries inherit these portable temporary paths.
  env.TEMP = temp;
  env.TMP = temp;
  app.setAppLogsPath(logs);
  return { portable: true, root, profile, games, backups, temp };
}

function writeAccountGuide(storage, state) {
  if (!storage.portable) return;
  const lines = [
    'ASTRIA - DADOS DAS CONTAS / ACCOUNT DATA',
    '',
    'Games: arquivos de save que voce exportou/baixou dentro dos jogos.',
    'Profile: configuracao, cookies, IndexedDB e outros dados locais dos sites.',
    'Automation: perfis de macros e alvos do Auto Clicker, separados por conta.',
    'Extensions: copias portateis das extensoes instaladas em cada conta.',
    'Backups: pasta livre para guardar suas copias de seguranca.',
    'O cache dos jogos fica dentro de Profile, separado por conta.',
    'Game caches are inside Profile, separate for each account.',
    'Automation: per-account macro profiles, timed targets and exported macro files.',
    'Extensions: portable copies of extensions installed separately in each account.',
    'SharedAssets: cache de versoes antigas; preservado, mas nao utilizado.',
    'Temp: temporarios do Astria, mantidos nesta pasta.',
    '',
    'Para transferir: feche o Astria e copie a pasta Astria inteira, incluindo Save.',
    'Para restaurar: feche o Astria e restaure a pasta Save inteira de seu backup.',
    'Use uma pasta com permissao de gravacao. Nao abra duas copias do mesmo Save ao mesmo tempo.',
    'Logins protegidos pelo Windows podem exigir nova autenticacao em outro computador.',
    'Jogos online normalmente guardam o progresso no servidor, vinculado a conta.',
    'Os arquivos de Profile sao bancos de dados do navegador; nao sao saves para abrir diretamente.',
    'O menu Exportar configuracao exporta apenas a lista e as preferencias das contas.',
    '',
    'CONTAS E PASTAS LOCAIS (caminhos relativos a Save):',
    ''
  ];
  for (const account of state.accounts) {
    const name = account.name.replace(/[\r\n]/g, ' ');
    lines.push(name, `  Site: ${new URL(account.url).hostname}`, `  Dados: Profile/Partitions/multinest-${account.id}`, '');
  }
  fs.writeFileSync(path.join(storage.root, 'LEIA-ME.txt'), lines.join('\r\n'), 'utf8');
}

module.exports = { configureStorage, writeAccountGuide };
