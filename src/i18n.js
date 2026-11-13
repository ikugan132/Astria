'use strict';
// Portuguese source phrases are retained for compatibility with the existing UI.
// Tagged templates translate static parts only; account/workspace names stay intact.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AstriaI18n = api;
})(typeof window === 'object' ? window : globalThis, () => {
  const strings = {
    'Extensões da conta':'Account extensions','Gerenciar extensões':'Manage extensions','Abrir em janela':'Open in a window','Fechar extensão':'Close extension','Largura da extensão':'Extension width','Arraste para ajustar a largura.':'Drag to adjust the width.',
    'Extensões':'Extensions','Extensões…':'Extensions…','Instalar extensão da pasta':'Install extension from folder','Extensão não encontrada.':'Extension not found.','Ative a extensão primeiro.':'Enable the extension first.',
    'IDs de contas conflitam neste Windows.':'Account IDs conflict on this Windows system.','A identidade da extensão mudou. Reinstale a pasta.':'The extension identity changed. Reinstall the folder.',
    'Arraste para reordenar':'Drag to reorder','Mover para cima':'Move up','Mover para baixo':'Move down',
    'Somente nesta conta. Instale uma pasta com manifest.json; os arquivos acompanham a pasta Save.':'Only in this account. Install a folder with manifest.json; its files stay in Save.',
    'A compatibilidade depende das APIs usadas pela extensão.':'Compatibility depends on the APIs used by the extension.',
    'Atualizar extensão':'Update extension','Escolha a pasta da extensão':'Choose the extension folder','Extensão atualizada para a versão ':'Extension updated to version ','Ativada':'Enabled','Desativada':'Disabled','Não carregada':'Not loaded','Ativar extensão':'Enable extension','Permissões solicitadas':'Requested permissions','Abrir painel':'Open panel','Remover extensão':'Remove extension','Nenhuma extensão instalada nesta conta.':'No extensions installed in this account.',
    'Depois de instalar, ativar ou remover, recarregue a conta para aplicar os scripts da página. Isso reconecta o jogo e para a automação.':'After installing, enabling or removing, reload the account to apply page scripts. This reconnects the game and stops automation.',
    'Instalar pasta…':'Install folder…','Recarregar conta':'Reload account','Alterações salvas. Recarregue a conta para aplicar os scripts.':'Changes saved. Reload the account to apply page scripts.',
    'Contas flutuantes…':'Floating accounts…','Escolher contas flutuantes':'Choose floating accounts','Marque uma ou mais contas para aparecerem sobre a conta principal. Cada janela tem seu próprio tamanho, posição e alfinete.':'Select one or more accounts to appear above the main account. Each window has its own size, position and pin.','Seleção de contas inválida.':'Invalid account selection.','Aplicar':'Apply',
    'Clique para trocar.':'Click to swap.','Diminuir janela':'Make window smaller','Aumentar janela':'Make window larger','Redimensionar · arraste ou use as setas':'Resize · drag or use arrow keys','Fixar janela':'Pin window','Desafixar janela':'Unpin window','Tamanho inválido.':'Invalid size.',
    'Flutuante':'Floating', 'Clique para trocar. Arraste para mover.':'Click to swap. Drag to move.', 'Mover para outro canto':'Move to next corner', 'Trocar com conta flutuante · setas para mover':'Swap with floating account · arrow keys to move', 'Posição inválida.':'Invalid position.',

    "Eco adaptativo":"Adaptive Eco",
    "Descanso visual":"Visual rest",
    "Modo Ultra":"Ultra mode",
    "Resolução fixa":"Fixed resolution",
    "Automática":"Automatic",
    "Resolução inválida.":"Invalid resolution.",
    "Opção inválida.":"Invalid option.",
    "Contas ocultas: até 2 FPS e áudio silenciado, sem desconectar.":"Hidden accounts: up to 2 FPS and muted audio, without disconnecting.",
    "Pausa novas imagens animadas. Imagens já carregadas podem continuar até o próximo carregamento. Timers, rede e workers continuam sob controle do jogo.":"Stops newly loaded animated images. Existing images may keep animating until reloaded. Timers, networking and workers remain under the game’s control.",
    "Eco adaptativo: até 60 FPS na conta em uso. As secundárias usam o limite de economia, até 10 FPS com 4 contas carregadas e 5 FPS com 8.":"Adaptive Eco: up to 60 FPS in the active account. Secondary accounts use the power-saving limit, up to 10 FPS with 4 loaded accounts and 5 FPS with 8.",
    "A resolução virtual se ajusta ao painel. O ganho depende de como o jogo desenha a imagem.":"The virtual resolution fits the panel. Savings depend on how the game renders its image.",
    "Limpar memória sem uso":"Clean unused memory",
    "Solicita a coleta de objetos JavaScript sem uso. Preserva dados, sessões e recursos ainda usados pelo jogo.":"Requests collection of unused JavaScript objects. Preserves data, sessions and resources the game still uses.",
    "Coleta solicitada. Recursos ainda usados pelo jogo permanecem na memória.":"Collection requested. Resources still used by the game remain in memory.",
    "Aguarde dois minutos entre limpezas da mesma página.":"Wait two minutes between cleanups of the same page.",
    "Feche as ferramentas de desenvolvimento antes de limpar.":"Close developer tools before cleaning memory.",
    "Já existe uma limpeza em andamento.":"Memory cleanup is already running.",
    "A página foi fechada.":"The page was closed.",
    "Modo Ultra: tela cheia para uma conta; as demais ficam em até 1 FPS. Saia pelo mesmo botão. Modos de economia mantêm a página carregada. Ativa quando visível descarrega após cinco minutos oculta; Suspender descarrega imediatamente.":"Ultra mode: fullscreen for one account; the others run at up to 1 FPS. Exit using the same button. Power-saving modes keep pages loaded. Active when visible unloads after five minutes hidden; Suspend unloads immediately.",

    'Sempre ativa · desempenho máximo':'Always active · maximum performance',
    'Economia de energia':'Power saving','FPS em economia':'Power-saving FPS','FPS inválido.':'Invalid FPS.',
    'Mantém a conta carregada e reduz os quadros de animação. O padrão é 15 FPS; escolha 1, 5, 10, 15 ou 30 FPS no menu da conta em Atividade. Timers, rede, animações CSS e workers continuam sob controle do jogo.':'Keeps the account loaded and reduces animation frames. The default is 15 FPS; choose 1, 5, 10, 15 or 30 FPS under Activity in the account menu. Timers, networking, CSS animations and workers remain controlled by the game.',
    'Economia de energia reduz o trabalho de animação, mas os dados e as imagens usados pelo jogo continuam na RAM. O consumo mínimo depende do jogo; não há um limite fixo de memória enquanto ele continua conectado.':'Power saving reduces animation work, but the data and images used by the game stay in RAM. Minimum memory use depends on the game; there is no fixed memory cap while it stays connected.',
    'Sempre ativa mantém a página carregada e os temporizadores ativos. Animações em segundo plano podem ter FPS reduzido. Ao minimizar, o jogo recebe o estado normal de página oculta do navegador.':'Always active keeps the page loaded and timers running. Background animations may run at reduced FPS. When minimized, the game receives the browser’s normal hidden-page state.',
    'Aguardando carregamento…':'Waiting to load…',
    'Cache nativo independente por conta':'Native cache, separate for each account',
    'O cache dos jogos é separado por conta e fica dentro de Save. Várias contas ativas dividem os recursos da CPU e da GPU.':'Game caches are separate per account and stay inside Save. Multiple active accounts compete for CPU and GPU resources.',
    'A renderização Canvas pode pausar em contas ocultas ou com a janela minimizada, mesmo com os timers ativos. Mantenha o jogo visível se ele exigir renderização contínua.':'Canvas rendering can pause in hidden accounts or while the window is minimized even though timers remain active. Keep the game visible if it requires continuous rendering.',
    'Meus jogos':'My games','Espaços e contas':'Workspaces and accounts','Espaços':'Workspaces','Espaço':'Workspace','Contas':'Accounts','Conta':'Account',
    'Novo espaço':'New workspace','Novo espaço…':'New workspace…','Nova conta':'New account','Nova conta…':'New account…',
    'Editar espaço':'Edit workspace','Editar espaço…':'Edit workspace…','Criar espaço':'Create workspace','Nome do jogo ou grupo':'Game or group name',
    'Tema escuro':'Dark mode','Alternar tema':'Toggle theme','Largura da lateral':'Sidebar width','Arraste para ajustar a lateral. Use as setas para ajuste fino.':'Drag to resize the sidebar. Use arrow keys for fine adjustments.',
    'Sempre ativa':'Always active','Ativa quando visível':'Active when visible','Suspensa · RAM liberada':'Suspended · memory released','Suspensa':'Suspended',
    'Ativa quando visível · descarrega após 5 minutos oculta':'Active when visible · unloads after five minutes hidden','Suspender · liberar RAM':'Suspend · release memory',
    'Suspender agora · liberar RAM':'Suspend now · release memory','Quando oculta: descarrega após 5 minutos':'When hidden: unloads after five minutes','Ao retomar, o jogo reconecta':'Resuming reconnects the game',
    'Atividade das contas':'Account activity','Atividade de ':'Activity for ','Atividade':'Activity','Retomar conta':'Resume account',' está suspensa':' is suspended',
    'A página foi descarregada para liberar RAM. Retomar abre o jogo com o perfil salvo.':'The page was unloaded to release memory. Resume reopens it with the saved profile.',
    'Mantém a página carregada e os timers ativos ao trocar de conta ou espaço. Usa mais recursos.':'Keeps the page loaded and timers active when switching accounts or workspaces. Uses more resources.',
    'Reduz a atividade quando oculta. Após cinco minutos, descarrega a página para liberar RAM. Ao voltar, o jogo reconecta.':'Reduces background activity. After five minutes hidden, unloads the page to release memory. Showing it reconnects the game.',
    'Descarrega imediatamente. Use Retomar conta para abrir novamente com o perfil salvo.':'Unloads immediately. Use Resume account to reopen with the saved profile.',
    'Descarregar pode interromper a atividade online do jogo. A progressão offline depende de cada jogo. Escolha o modo no botão direito da conta.':'Unloading may interrupt online activity. Offline progress depends on the game. Right-click the account to choose its mode.',
    'Erro ao carregar':'Loading error','Carregando…':'Loading…','Abrindo ':'Opening ','Processo encerrado: ':'Process exited: ',
    'Crie sua primeira conta.':'Create your first account.','Seu próximo espaço.':'Your next workspace.',
    'Adicione um jogo. Cada conta tem seu próprio login e pode ter uma cor e um modo de atividade.':'Add a browser game. Each account has its own login, color and activity mode.',
    'Criar conta':'Create account','Renomear conta':'Rename account','Renomear conta…':'Rename account…','Editar endereço':'Edit address','Editar endereço…':'Edit address…',
    'Escolha um nome e o endereço do jogo. O login fica separado das outras contas.':'Choose a name and the game URL. Its login stays separate from the other accounts.',
    'Nome da conta':'Account name','Nome do personagem':'Character or account name','Nome':'Name','Endereço':'URL','Endereço inicial':'Home page',
    'https://site-do-jogo.com':'https://game.example.com','Nova conta neste espaço…':'New account in this workspace…','Remover painel…':'Remove panel…',
    'Escolher cor':'Choose color','Escolher cor…':'Choose color…','Cor de ':'Color for ','Arraste na roda para escolher o tom e ajuste o brilho.':'Drag on the wheel to choose a hue and adjust brightness.',
    'Matiz e saturação':'Hue and saturation','Matiz ':'Hue ',' graus, saturação ':' degrees, saturation ','Brilho':'Brightness','Cor hexadecimal':'Hex color','Salvar cor':'Save color',
    'Cancelar':'Cancel','Salvar':'Save','Excluir':'Delete','Remover':'Remove','Remover ':'Remove ','Fechar':'Close','Entendi':'Got it',
    'Os painéis deste espaço serão removidos.':'The panels in this workspace will be removed.','O painel será removido.':'The panel will be removed.',
    ' Os perfis e logins salvos no computador serão preservados.':' Saved profiles and logins will be kept.',
    'Atualizar':'Reload','Atualizar sem cache':'Reload without cache','Ativar áudio':'Unmute','Silenciar':'Mute','Áudio de ':'Audio for ','Aumentar':'Zoom in','Diminuir':'Zoom out','Restaurar 100%':'Reset to 100%',
    'Layout dos painéis':'Panel layout','Opções da conta':'Account options','Opções de ':'Options for ','Grade automática':'Auto grid','Colunas':'Columns','Linhas':'Rows','Uma conta por vez':'One account at a time',
    'Exportar configuração…':'Export configuration…','Importar configuração…':'Import configuration…','Importar configuração':'Import configuration',
    'Substitui a lista atual de espaços e contas. O arquivo não inclui cookies nem senhas.':'Replaces the current workspace and account list. The file contains no cookies or passwords.',
    'Escolher arquivo':'Choose file','Configuração importada.':'Configuration imported.','Exportar espaços e contas (não inclui cookies)':'Export workspaces and accounts (no cookies)',
    'Importar espaços e contas (substitui a configuração)':'Import workspaces and accounts (replaces configuration)','Logins e cookies não estão neste arquivo.':'Logins and cookies are not included in this file.',
    'Abrir pasta Save':'Open Save folder','Abrir pasta de dados':'Open data folder','Desempenho':'Performance','Sobre os modos…':'About activity modes…',
    ' painéis carregados · ~':' panels loaded · ~',' MB no aplicativo':' MB in the app','Cache público: ':'Public cache: ',' reutilizações · ':' reuses · ',' MB poupados nesta execução':' MB of content reused this run',
    'Ativa quando visível economiza RAM após 5 minutos':'Active when visible saves memory after five minutes','Suspender descarrega o painel imediatamente':'Suspend unloads the panel immediately',' · Portátil':' · Portable',
    'RAM aproximada dos processos da página: ':'Approximate page process memory: ',' Processo compartilhado com outro painel.':' Process shared with another panel.',
    ' processo(s).':' process(es).',' Não inclui o custo compartilhado do aplicativo e da GPU.':' Excludes shared application and GPU overhead.','Aguardando medição dos processos da página.':'Waiting for page process measurements.',
    'Verificar atualizações…':'Check for updates…','Atualizar Astria':'Update Astria','Verificando a última versão no GitHub…':'Checking the latest version on GitHub…',
    'O download é verificado com a assinatura do Astria. Seus perfis e a pasta Save são preservados. Reiniciar desconecta temporariamente os jogos.':'The download is verified with Astria’s signature. Your profiles and Save folder are preserved. Restarting temporarily disconnects games.',
    'Verificando…':'Checking…','Tentar novamente':'Try again',' está atualizado.':' is up to date.','Versão ':'Version ',' disponível · ':' available · ',
    'Baixar atualização':'Download update','Baixando…':'Downloading…','Baixando e verificando os arquivos…':'Downloading and verifying files…',
    ' verificada. A versão anterior ficará em Save/Backups.':' verified. The previous program will be kept in Save/Backups.','Reiniciar e atualizar':'Restart and update',
    'Não foi possível concluir.':'Could not complete the action.','Não foi possível carregar a configuração.':'Could not load the configuration.',
    'Informe um endereço http/https válido.':'Enter a valid HTTP/HTTPS URL.','URL inválida.':'Invalid URL.','Apenas sites http/https são permitidos.':'Only HTTP/HTTPS websites are allowed.','URL inválida ou contém credenciais.':'Invalid URL or URL contains credentials.',
    'Arquivo de configuração inválido.':'Invalid configuration file.','Conta não encontrada.':'Account not found.','Espaço não encontrado.':'Workspace not found.','Origem não autorizada.':'Unauthorized origin.',
    'Mantenha pelo menos um espaço.':'Keep at least one workspace.','Layout desconhecido.':'Unknown layout.','Sessão salva no disco; dados do site não foram apagados.':'Session saved on disk; website data was not deleted.',
    'Conta fora deste espaço.':'Account is outside this workspace.','Informe o nome da conta.':'Enter the account name.','Cor inválida.':'Invalid color.','Modo de atividade inválido.':'Invalid activity mode.',
    'Retome a conta suspensa primeiro.':'Resume the suspended account first.','Zoom inválido.':'Invalid zoom.','Largura inválida.':'Invalid width.','Arquivo muito grande.':'File is too large.','Idioma inválido.':'Invalid language.',
    'Copiar':'Copy','Colar':'Paste','Selecionar tudo':'Select all','Idioma':'Language',
    'Assinatura da atualização inválida.':'Invalid update signature.','Atualização incompatível.':'Incompatible update.','Pacote inválido.':'Invalid package.','Lista de arquivos inválida.':'Invalid file list.',
    'Caminho ou arquivo não autorizado.':'Unauthorized path or file.','Pacote incompleto ou muito grande.':'Package is incomplete or too large.','Arquivos ausentes no ZIP.':'Files are missing from the ZIP.',
    'Entrada ZIP não autorizada.':'Unauthorized ZIP entry.','Pasta ZIP não autorizada.':'Unauthorized ZIP directory.','Arquivo ZIP não corresponde ao manifesto.':'ZIP file does not match the manifest.','Conteúdo extraído inválido.':'Invalid extracted content.',
    'Servidor de atualização não autorizado.':'Unauthorized update server.','GitHub indisponível (':'GitHub unavailable (','Redirecionamentos demais.':'Too many redirects.','Repositório de atualização não configurado.':'Update repository is not configured.',
    'Release inválida.':'Invalid release.','Versão assinada não corresponde à release.':'Signed version does not match the release.','Verifique as atualizações primeiro.':'Check for updates first.',
    'Use a edição portátil para atualizar dentro do Astria.':'Use the portable edition to update within Astria.','Tamanho do download inválido.':'Invalid download size.','A verificação do download falhou.':'Download verification failed.',
    'Pasta do programa não é regular.':'Program directory is not a regular directory.','Arquivo do programa não é regular.':'Program file is not a regular file.','Baixe e verifique a atualização primeiro.':'Download and verify the update first.',
    'A atualização já está sendo preparada.':'The update is already being prepared.','Não foi possível preparar a atualização. Consulte Save/Updates/apply.log.':'Could not prepare the update. See apply.log inside the update’s Save/Updates folder.',
    'A preparação da atualização demorou demais. Seus jogos continuam abertos.':'Update preparation timed out. Your games remain open.','Resposta muito grande.':'Response is too large.'
  };
  Object.assign(strings,typeof module==='object'&&module.exports?require('./automation-i18n'):globalThis.AstriaAutomationStrings||{});
  strings['Parar automação']='Stop automation';
  strings['Pare a automação antes de limpar a memória.']='Stop automation before cleaning memory.';
  Object.assign(strings,{'Ponto inválido.':'Invalid point.','Aguarde o carregamento da página.':'Wait for the page to load.','Adicione e ative um alvo primeiro.':'Add and enable a target first.','Configuração de automação inválida.':'Invalid automation settings.','Parar todas as automações':'Stop all automation','Clique para marcar · Setas para ajustar · Enter confirma · Esc ou botão direito cancela':'Click to mark · Arrows to adjust · Enter to confirm · Esc or right-click to cancel'});
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(Object.keys(strings).sort((a,b)=>b.length-a.length).map(escape).join('|'), 'g');
  function translate(value, language = 'en') {
    value = String(value);
    return language === 'pt-BR' ? value : value.replace(pattern, match => strings[match]);
  }
  function tag(parts, values, language) {
    return parts.map((part,index)=>translate(part,language)+(index<values.length?values[index]:'')).join('');
  }
  return { translate, tag, strings };
});
