# Astria

[English](README.md) · [Português (Brasil)](README.pt-BR.md)

Navegador compacto e portátil de múltiplas contas para **jogos de navegador** no Windows. Abra os jogos que escolher, mantenha sessões separadas, organize as janelas e controle quais páginas continuam ativas. Não inclui contas nem arquivos de jogos.

## Baixar e abrir

**[Baixe o ZIP portátil mais recente](https://github.com/IgorKugan/Astria/releases/latest)** em Releases. Escolha `Astria-Portable-x.y.z.zip`. Os arquivos automáticos “Source code” do GitHub são para desenvolvimento e não são o aplicativo pronto.

1. Extraia o ZIP inteiro para uma pasta curta com permissão de gravação, como `D:\Astria`.
2. Abra **Astria.exe** dentro da pasta extraída.
3. Mantenha todos os arquivos de suporte e `portable.flag` ao lado do executável.

Requer Windows x64. Não precisa de Node.js nem de instalador. O Windows pode mostrar SmartScreen ou Firewall porque o executável não tem certificado comercial de assinatura do Windows.

## Atualizar sua pasta copiando os arquivos

1. Feche o Astria e faça uma cópia de segurança da pasta atual.
2. Extraia o novo ZIP em outro local.
3. Copie **todos os arquivos e pastas de dentro de `Astria-Portable-x.y.z`** para sua pasta Astria atual, substituindo os arquivos do programa. `Astria.exe` deve ficar ao lado da sua pasta `Save`, não dentro de outra subpasta.
4. **Mantenha sua pasta Save atual.** O ZIP de distribuição não inclui Save e não substitui perfis, logins nem saves baixados.
5. Abra Astria.exe na pasta atual.

Também é possível usar **☰ → Verificar atualizações… → Baixar atualização → Reiniciar e atualizar**. O programa verifica a assinatura, preserva Save e guarda o programa anterior em Save/Backups. Não força um reinício durante o jogo.

**Atualizando da 1.6.0 ou 1.6.1:** o atualizador dessas versões pode parar após fechar o Astria no Windows. Use as instruções de substituição pelo ZIP acima nesta primeira atualização. A 1.6.2 corrige o auxiliar para as próximas atualizações dentro do programa. A pasta Save fica separada dos arquivos do aplicativo.

## Idioma

Abra **☰ → Idioma → English / Português (Brasil)**. A escolha fica salva e altera imediatamente a interface, os menus e os diálogos do Astria. O idioma dos jogos e sites continua sendo definido por eles. Instalações novas começam em inglês; perfis existentes continuam em português até você escolher outro idioma.

## Contas, layouts e atividade

- Use **+** para criar um espaço ou uma conta. Informe o endereço HTTP/HTTPS do jogo de navegador e entre pela página.
- Cada conta tem cookies, localStorage, IndexedDB, CacheStorage e service workers separados.
- Selecionar uma conta ou espaço transfere o foco do teclado ao jogo visível. Você pode usar os controles sem clicar novamente na página; diálogos e campos de chat mantêm seu próprio foco.
- Os atalhos, incluindo Ctrl+W, Alt+W, Ctrl+R e F5, chegam ao jogo em foco com seus modificadores preservados. O Astria não atribui atalhos de navegador para fechar, recarregar ou abrir abas. Use a barra ou os menus para ações do navegador e o botão Fechar da janela para sair. Atalhos reservados pelo Windows continuam sob controle do Windows.
- Clique com o botão direito para renomear, escolher cor, ajustar som/zoom ou mudar a atividade.
- Clique no alto-falante ao lado do indicador de RAM/CPU do painel para ativar ou silenciar o áudio daquela conta, incluindo seus popups. O alto-falante riscado indica áudio silenciado. Cada conta mantém essa escolha após reiniciar.
- Arraste a borda da lateral para mudar a largura. A barra de cada painel tem layout, tema e uso aproximado de RAM/CPU.

| Modo | Comportamento |
| --- | --- |
| Sempre ativa / desempenho máximo | Ícone de velocímetro. Mantém a página carregada e não impõe limite de FPS às animações. Usa mais recursos. |
| Eco adaptativo | Bateria com raio. Até 60 FPS na conta ativa; as secundárias se ajustam à quantidade de contas carregadas. |
| Economia de energia | Ícone de bateria com raio. Mantém a conta carregada em outros espaços e limita os quadros de animação a 15 FPS por padrão. |
| Ativa quando visível | Reduz atividade em segundo plano e descarrega uma página oculta após cinco minutos. Ao voltar, reconecta o jogo. |
| Suspensa | Descarrega imediatamente. Retomar reabre o mesmo perfil salvo. |

O botão de bateria com raio seleciona **Eco adaptativo**: até 60 FPS na conta em uso; as secundárias usam o limite de economia até 15 FPS, com máximo de 10 FPS a partir de quatro contas carregadas e 5 FPS a partir de oito. Configurações existentes de economia manual são preservadas. Para limite fixo, use **Atividade → Economia de energia** no menu da conta e **FPS em economia → 1 / 5 / 10 / 15 / 30 FPS**. Ambos mantêm a mesma página e conexão.

Abra o botão de ajustes ao lado do custo da página ou **☰ → Desempenho → Sobre os modos** para:

- **Descanso visual:** contas ocultas já carregadas continuam conectadas em até 2 FPS e sem áudio. Ao mostrar a conta, volta a escolha de áudio salva. Desativa animações de imagens novas; o Chromium pode manter imagens já carregadas animadas até recarregar. Não recarregue uma partida só para aplicar essa opção.
- **Resolução fixa por conta:** Automática, 720p (1280×720), 768p (1366×768), 900p (1600×900) ou 1080p (1920×1080). A área virtual usa escala de dispositivo 1 e se ajusta ao painel sem cortes, preservando o zoom salvo. Pode reduzir o custo quando o jogo dimensiona seu canvas pela área disponível; não reduz todos os arquivos do jogo.
- **Modo Ultra:** o botão de expandir mostra uma conta em tela cheia e limita as demais carregadas a 1 FPS, sem desconectar. Saia pelo mesmo botão. Trocar de conta/espaço encerra Ultra. Descanso visual e Ultra também mantêm carregadas páginas já abertas em Ativa quando visível; desativá-los restaura a regra normal de descarregar após cinco minutos.
- **Limpar memória sem uso:** solicita manualmente a coleta de objetos JavaScript daquela conta. Preserva objetos vivos, dados e conexões. As solicitações são serializadas, com intervalo de dois minutos após sucesso; ignora páginas em depuração. Texturas e dados ainda usados pelo jogo não podem ser removidos da RAM com segurança.

O logo tem uma estrela com raios para fora e uma expansão curta ao abrir. A preferência de movimento reduzido desativa a animação. Não há animação contínua consumindo recursos durante o jogo.

A economia limita callbacks de requestAnimationFrame na página, nos frames incorporados e nos popups da conta. Relógios, timers, rede, animações CSS e workers continuam nativos; por isso não há garantia de um consumo fixo de CPU ou energia. Jogos que calculam progresso por quadro podem se comportar de outra forma com FPS reduzido. O FPS real pode ficar abaixo da meta quando a página estiver coberta, minimizada ou sob carga. A página continua usando RAM para dados ativos, imagens e outros recursos do jogo; reduzir FPS não remove esses arquivos nem impõe um limite fixo seguro de memória. Economia de energia nunca descarrega a conta. Suspensa libera a memória do processo da página e desconecta o jogo.

Descarregar pode desconectar o personagem. A progressão offline depende do jogo. As métricas não incluem o custo compartilhado do aplicativo/GPU. A compatibilidade depende do site e de sua autenticação.

### Layout flutuante

Escolha **Layout → Flutuante** na barra do painel ou no menu do aplicativo e marque quais contas ficarão flutuando. É possível selecionar várias secundárias ou deixar todas desmarcadas para mostrar apenas a principal. Abra **Layout → Contas flutuantes…** ou o menu do botão direito da conta para mudar a seleção depois.

Clique em uma pequena para trocar aquela conta com a principal; as outras flutuantes permanecem no lugar. Segure e arraste para mover sem trocar. Arraste o canto inferior direito para redimensionar mantendo as proporções do jogo. Os botões **− / +** ajustam sem arrastar; foque o controle do canto e use as setas para ajustes finos. O **alfinete** bloqueia movimento e redimensionamento, mantendo o clique para trocar. Cada janela salva sua posição, tamanho relativo e estado fixado por espaço. O botão de canto move para o próximo canto. O botão de troca e as setas na barra principal controlam a primeira flutuante.

Ao escolher outra conta na lateral, a anterior ocupa a janela daquela conta, ou a primeira flutuante caso ela não estivesse flutuando. As páginas mantêm suas sessões e modos de atividade, sem capturas periódicas de tela nem outra instância do jogo. As janelas ficam dentro da imagem do jogo ao redimensionar ou usar resolução fixa. Contas suspensas reaparecem ao retomar. Diálogos e outros espaços ocultam as janelas. No Ultra em tela cheia as flutuantes continuam trocando e seguem o limite de quadros que o Ultra já aplica às secundárias.

O clique esquerdo na cor seleciona a conta, inclusive com a lateral recolhida. Para personalizar a cor, clique com o botão direito na conta e escolha **Escolher cor…**.

## Dados portáteis

### Automação nativa

Abra o botão **Automação** da conta ou clique nela com o botão direito e escolha **Auto Clicker…** / **Macro Maker…**. São ferramentas separadas:

- **Auto Clicker:** adicione alvos, marque os pontos na página do jogo, escolha o botão do mouse ou entrada de teclado e o intervalo de cada alvo. Cada ponto pode mostrar um círculo com 50% de opacidade, vermelho por padrão, com escolha de cor. Desative **Mostrar círculo** para manter as ações funcionando sem nenhuma marca. Os marcadores não têm nome, mira nem contagem. A prévia mostra o jogo temporariamente. As entradas ficam naquela conta e o cursor do Windows continua livre.
- **Macro Maker:** organize passos de tecla, clique, movimento, rolagem, texto e espera; configure pausas e repetições, execute uma vez ou em ciclos e importe/exporte arquivos JSON do Macro Maker versão 2.

Os pontos pertencem à página da conta e acompanham as janelas flutuantes, a resolução fixa, o zoom e as trocas com a principal. Se o jogo reorganizar os controles, marque novamente. Clicar para escolher o ponto não clica no jogo. Esc ou botão direito cancelam a seleção.

Cada conta funciona de forma independente. Iniciar uma ferramenta para a outra naquela conta. Use **Parar**, o menu da conta ou **Menu → Automação → Parar todas as automações**. Os atalhos normais do jogo continuam disponíveis. Recarregar/navegar, suspender ou fechar a conta para a automação; reabrir o Astria nunca inicia sozinho. A política existente de descarregar após cinco minutos ainda vale para Ativa quando visível. Não são criadas outras instâncias do jogo nem capturas contínuas de tela.

As configurações e exportações ficam em **Save/Automation**, separadas dos perfis dos jogos. Importar um macro nunca dá controle sobre o desktop: todas as entradas ficam na conta escolhida do Astria.

Páginas abertas em segundo plano começam com uma área de tamanho adequado, baseada no painel visível, em vez de uma superfície de 1×1 pixel. Assim, os jogos podem calcular o Canvas, a câmera e a interface iniciais em um tamanho normal. Trocar entre contas Sempre ativas mantém a mesma página e seu estado em memória; não recarrega nem copia dados de outra conta.

O Astria cria **Save** ao lado do executável ao abrir pela primeira vez:

| Pasta | Conteúdo |
| --- | --- |
| Profile | Configurações e perfis Chromium separados das contas |
| Games | Arquivos/saves baixados ou exportados dos jogos |
| Backups | Exportações e programas anteriores das atualizações |
| Updates | Preparação de atualizações verificadas e registros locais |
| Temp, Logs, CrashDumps | Arquivos temporários e de diagnóstico |

Use **☰ → Abrir pasta Save**. `Save/LEIA-ME.txt` relaciona os nomes das contas às suas pastas. Para transferir ou fazer backup, feche o Astria e copie a **pasta inteira, incluindo Save**. Não abra duas cópias usando o mesmo Save.

O progresso online normalmente fica no servidor. Cookies protegidos pelo Windows podem exigir novo login em outro PC ou usuário. Exportar configuração inclui nomes, endereços e preferências, mas não cookies nem senhas. **Nunca compartilhe seu Save preenchido.** Distribua o ZIP limpo.

Cada conta usa o cache HTTP nativo do Chromium dentro de seu próprio perfil. Os arquivos dos jogos não são interceptados nem transferidos pelo processo principal do Astria. Isso pode usar mais disco que um cache compartilhado, mas evita essa etapa extra no carregamento. Pastas `Save/SharedAssets` de versões anteriores são preservadas, mas não são mais utilizadas. Todos os caches vão junto com Save.

Sempre ativa mantém as páginas carregadas e os timers funcionando ao trocar de conta ou espaço e ao abrir diálogos do Astria. Jogos cobertos podem animar com FPS reduzido. Cada jogo ativo continua usando sua própria CPU, RAM e GPU; várias contas podem reduzir o FPS disponível para a conta selecionada. Use Ativa quando visível ou Suspensa nas contas que não precisam continuar funcionando. Minimizar ou ocultar o aplicativo aplica o comportamento normal de página oculta do Chromium, permitindo que os jogos usem seus próprios mecanismos de atualização em segundo plano. A progressão online depende do jogo, principalmente quando ele calcula o progresso por quadros de animação em vez do tempo decorrido.

Fechar o Astria ou reiniciá-lo para atualizar permite que as páginas executem seus eventos normais de saída antes do encerramento do navegador e depois grava seus dados locais pendentes. Assim, os jogos podem enviar suas últimas mensagens de conexão/salvamento. Uma página que não termina de fechar tem um limite de cinco segundos. Isso não garante recuperar um estado já perdido no servidor do jogo.

Ao abrir o Astria, a conta visível selecionada inicia primeiro. As outras páginas visíveis usam uma pequena fila de carregamento; as contas ocultas em Sempre ativa ou Economia de energia abrem uma por vez após terminar a navegação visível. Uma página lenta libera sua posição inicial na fila após dez segundos para não bloquear as demais indefinidamente. Selecionar uma conta na fila dá prioridade a ela. Os modos de atividade e as sessões salvas são preservados.

Para abrir mais rápido após ligar o PC, mantenha a pasta portátil Astria inteira, incluindo Save, em um SSD. Um HD mecânico pode demorar mais enquanto o Windows ainda não tem os arquivos do programa e dos perfis em cache. Feche o Astria antes de mudar de local; não é necessário apagar caches ou perfis.

## Política do projeto e segurança

O projeto oficial é mantido pelo proprietário. Pull requests, issues e discussões externas estão desativados. Outras pessoas podem baixar versões e ler o código público, mas não enviar alterações diretamente ao repositório oficial. O material público continua copiável conforme a licença incluída.

Veja [SECURITY.md](SECURITY.md) para relatos privados de vulnerabilidades e limites de segurança. Instruções de compilação do proprietário: [CONTRIBUTING.md](CONTRIBUTING.md). Licença MIT.
