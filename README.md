# Central de Controle Anatômico – IDOMED

Controle de corpos, aulas práticas e depreciação das unidades IDOMED.
Os dados ficam no **Supabase**, o código fica no **GitHub** e o site fica no ar pelo **Netlify**.
Cada vez que um arquivo muda no GitHub, o Netlify publica a nova versão sozinho.

## Estrutura

```
central-controle-anatomico/
├── index.html                  página do app
├── css/style.css               visual (cores IDOMED + ITC)
├── js/config.js                endereço e chave do Supabase
├── js/app.js                   lógica: unidades, painel, depreciação, aulas, relatórios
├── assets/                     logos ITC e IDOMED (fundo transparente)
├── supabase/migracao-unidades.sql   script do banco (rodar uma vez)
└── netlify.toml                configuração do Netlify (sem build)
```

## Como colocar no ar (uma vez só, uns 10 minutos)

### 1. Supabase: preparar o banco
1. Entre em https://supabase.com/dashboard e abra o projeto **pzewtlowmahindaakeda**.
2. Menu lateral **SQL Editor** → **New query**.
3. Cole todo o conteúdo de `supabase/migracao-unidades.sql` e clique em **Run**.
4. Em **Table Editor** deve aparecer a tabela `cadaver_unidades` com as 3 unidades.

> Os corpos, tipos de aula e aulas que já existiam vão para a **IDOMED Cittá**.
> Se forem de outra unidade, troque o nome no passo 4 do script antes de rodar.

### 2. GitHub: guardar o código
1. Entre em https://github.com/new.
2. Nome do repositório: `central-controle-anatomico`. Pode ser **Private**. Clique em **Create repository**.
3. Na página do repositório vazio, clique em **uploading an existing file**.
4. Arraste **o conteúdo** desta pasta (os arquivos e as pastas `css`, `js`, `assets`, `supabase`), não a pasta em si.
   O `index.html` precisa ficar na raiz do repositório.
5. Clique em **Commit changes**.

### 3. Netlify: colocar online
1. Entre em https://app.netlify.com e faça login **com a conta do GitHub**.
2. **Add new site** → **Import an existing project** → **GitHub**.
3. Autorize o Netlify e escolha o repositório `central-controle-anatomico`.
4. Deixe **Build command** vazio e **Publish directory** como `.` (o `netlify.toml` já faz isso). Clique em **Deploy**.
5. Em **Site configuration** → **Change site name**, use `controle-anatomico-idomed`.

O app fica em: **https://controle-anatomico-idomed.netlify.app**
(se o nome estiver ocupado, o Netlify avisa; escolha outro parecido).

## Atualizar o app depois
Edite ou substitua o arquivo no GitHub (botão de lápis ou **Add file → Upload files**) e faça o commit.
O Netlify publica a nova versão em menos de um minuto.

## Segurança: ponto de atenção
Hoje as tabelas aceitam leitura e escrita de qualquer pessoa que tenha o link do site
(a chave em `js/config.js` é a chave pública "anon"). Para uso interno com link restrito funciona,
mas o próximo passo recomendado é ativar login (Supabase Auth) e limitar as regras do banco a usuários logados.
