# Deploy Seguro na VPS

## 1) Medidas obrigatórias antes de publicar

1. Rotacione imediatamente todos os segredos já usados:
- `JWT_SECRET`
- `DB_PASSWORD`
- `SANKHYA_CLIENT_SECRET`
- `SANKHYA_TOKEN` / `SANKHYA_X_TOKEN`

2. Nunca suba segredos no Git. Use `.env.production` apenas no servidor.

3. Use domínio + HTTPS (Traefik com Let's Encrypt).

## 2) Preparação da VPS (Ubuntu)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin ufw fail2ban
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

Após isso, faça logout/login.

## 3) Firewall e SSH

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

No SSH (`/etc/ssh/sshd_config`), recomenda-se:
- `PermitRootLogin no`
- `PasswordAuthentication no` (usar chave SSH)

Depois:
```bash
sudo systemctl restart ssh
```

## 4) Arquivo de ambiente seguro

No servidor, dentro da pasta do projeto:

```bash
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

## 5) Deploy com stack

```bash
docker swarm init
docker network create --driver overlay --attachable portaleletricos
docker stack deploy -c docker-compose.deploy.final.yml contagem --with-registry-auth
docker stack services contagem
```

## 6) Validação pós deploy

1. Verifique HTTPS:
- `https://SEU_DOMINIO`

2. Verifique headers de segurança:
```bash
curl -I https://SEU_DOMINIO
```

3. Verifique API:
```bash
curl -I https://SEU_DOMINIO/api
```

## 7) Reforços recomendados

1. Habilitar backup diário do Postgres (offsite).
2. Limitar acesso SSH por IP (se possível).
3. Monitorar logs e tentativas de login (Fail2ban + logs Docker).
4. Atualizar SO e imagens Docker regularmente.
5. Revisar permissões de usuários no app (princípio do menor privilégio).

## 8) Observação importante

Segurança absoluta não existe. O objetivo é reduzir muito a superfície de ataque:
- segredos fora do Git
- menor privilégio
- TLS obrigatório
- proteção de brute-force/rate limit
- sistema e dependências atualizados.

## 9) Deploy atual do coletor na VPS

O coletor em produção roda pelo compose em `/opt/sistema-de-contagem-nova` e é exposto pelo proxy `coletor-proxy`.

Na VPS atual, o arquivo de ambiente usado pelo compose e `contagem-nova.env`. Se uma VPS futura padronizar `.env.production`, siga o mesmo procedimento preservando o arquivo equivalente.

Antes de publicar uma release:

1. Confirme que a PR foi revisada e mergeada em `main`.
2. Faça backup da pasta atual:

```bash
mkdir -p /opt/backups
cp -a /opt/sistema-de-contagem-nova "/opt/backups/sistema-de-contagem-nova-$(date +%Y%m%d-%H%M%S)"
```

3. Faça dump do banco atual:

```bash
mkdir -p /opt/sistema-de-contagem-nova/backups
docker exec sistema-de-contagem-nova-db-1 sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "/opt/sistema-de-contagem-nova/backups/db-$(date +%Y%m%d-%H%M%S).sql"
```

4. Preserve o arquivo `contagem-nova.env` da VPS.
5. Atualize o código e suba os containers:

```bash
cd /opt/sistema-de-contagem-nova
docker compose --env-file contagem-nova.env -f docker-compose.nova-vps.yml up -d --build
docker compose --env-file contagem-nova.env -f docker-compose.nova-vps.yml ps
```

6. Valide:

```bash
curl -I https://coletor.vps.portaleletricos.com.br
curl -I https://coletor.vps.portaleletricos.com.br/api
```

7. Teste login, abertura de contagem e validacao de EAN.

Rollback de aplicação:

```bash
cd /opt
mv sistema-de-contagem-nova "sistema-de-contagem-nova-falha-$(date +%Y%m%d-%H%M%S)"
cp -a /opt/backups/sistema-de-contagem-nova-YYYYMMDD-HHMMSS /opt/sistema-de-contagem-nova
cd /opt/sistema-de-contagem-nova
docker compose --env-file contagem-nova.env -f docker-compose.nova-vps.yml up -d --build
```

Rollback de banco deve ser usado apenas em caso de corrupção causada pelo deploy. Para ajustes operacionais de inventário, prefira correção controlada no Sankhya.
