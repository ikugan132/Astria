# Astria 1.13.4 — update an extension with one click

## English

- New **Update extension** button on each extension in the extension manager. It copies the extension again from the folder it was installed from, without asking for the folder. The extension keeps its identity, its saved data and whether it is enabled.
- Extensions installed before this version have no remembered folder: the first update asks for it once.
- **Install folder…** on an extension that is already installed now updates it instead of refusing (for extensions whose manifest has its own `key`).
- If the folder has an invalid manifest or holds a different extension, the update is refused and the installed copy is kept.

After updating, use **Reload account** to apply page scripts. Update Astria using **Menu → Check for updates**.

## Português (Brasil)

- Novo botão **Atualizar extensão** em cada extensão no gerenciador. Ele copia a extensão de novo da pasta de onde foi instalada, sem pedir a pasta. A extensão mantém a identidade, os dados salvos e se está ativada.
- Extensões instaladas antes desta versão não têm a pasta lembrada: a primeira atualização pede a pasta uma vez.
- **Instalar pasta…** em uma extensão já instalada agora atualiza em vez de recusar (para extensões cujo manifest tem a própria `key`).
- Se a pasta tiver um manifest inválido ou for de outra extensão, a atualização é recusada e a cópia instalada é mantida.

Depois de atualizar, use **Recarregar conta** para aplicar os scripts da página. Atualize o Astria em **Menu → Verificar atualizações**.
