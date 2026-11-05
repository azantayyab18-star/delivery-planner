# OSRM + VROOM on Oracle Cloud (development)

Development setup: the FastAPI backend stays on **Render**; road routing (**OSRM**) and route optimisation
(**VROOM**) run on an **Oracle Cloud** server. Caddy puts HTTPS and a username/password in front of both, so only
our backend can use them. The rider app never talks to this server: everything goes through the backend.

```
Rider app ──► Render (FastAPI + worker) ──HTTPS + basic auth──► Oracle: Caddy ─┬─► OSRM  (road distances, lines)
                                                                               └─► VROOM (stop order, uses OSRM)
```

Everything here is plain Docker, so moving to the client's hosting later is the same steps on any Linux server
(ARM or Intel/AMD).

## 1. Create the server (Oracle Cloud console)

1. **Compute → Instances → Create instance**
   - **Image:** Canonical Ubuntu 24.04 (the *aarch64* build appears when the shape below is chosen).
   - **Shape:** Ampere → `VM.Standard.A1.Flex`, **2 OCPU, 12 GB memory**: the whole Always Free allowance
     (1,500 OCPU hours and 9,000 GB hours a month). Serving OSRM + VROOM needs far less; the memory is for building the map.
   - **Boot volume:** 100 GB (Always Free covers 200 GB of boot + block storage in total).
   - **Networking:** a public subnet, *Assign a public IPv4 address* on.
   - **SSH keys:** upload your public key (or let Oracle generate one and download it).
   - If it says *Out of capacity*, try another availability domain, or later; free Ampere capacity comes and goes.
2. **Open ports 80 and 443:** Networking → Virtual cloud networks → your VCN → the subnet → its **Security list** →
   **Add ingress rules**: source `0.0.0.0/0`, TCP, destination port `80`; again for `443`.
   (Port 80 is only for the HTTPS certificate; OSRM and VROOM themselves are not exposed.)
3. Note the instance's **public IP**, e.g. `140.238.12.34`.

## 2. Prepare the server (once)

```bash
ssh -i <your-key> ubuntu@140.238.12.34
git clone https://github.com/azantayyab18-star/delivery-planner.git
cd delivery-planner
bash infra/routing/oracle/setup-server.sh     # Docker, firewall 80/443, 8 GB swap
exit                                          # log out and back in so "docker" works without sudo
```

## 3. Build the map (once; again to refresh)

**Start with Ireland** (Ireland + Northern Ireland: ~0.5 GB download, about 10–20 minutes, fits easily in 12 GB).
Britain + Ireland (~2 GB) is tight on the free server's 12 GB: it should get through with the 8 GB swap from step 2,
but slowly (an hour or more). If it fails with an out-of-memory error, build it on a bigger machine (e.g. a 16 GB PC
with Docker, the same script) and copy `infra/routing/data/` to the server with `scp -r`.

For Ireland, the defaults in `.env.example` are already right: skip the `nano` step below. For Britain + Ireland:

```bash
ssh -i <your-key> ubuntu@140.238.12.34
cd delivery-planner/infra/routing
cp .env.example .env
nano .env
```

In `.env` set:

```
OSRM_PROFILE=bicycle      # riders on bikes/scooters; "car" for vans. Changing it later means building again.
OSM_EXTRACT_URL=https://download.geofabrik.de/europe/britain-and-ireland-latest.osm.pbf
```

Then:

```bash
./scripts/prepare-ireland.sh
```

It downloads the extract and builds the routing data. The files are named `data/ireland.osrm*` whatever the region (the script's name comes from the first Ireland-only
version); the services below expect that name.

## 4. Start OSRM, VROOM and Caddy

Pick the public name. Without a domain, use the IP through **sslip.io** (free, nothing to register):
`140.238.12.34` → `140-238-12-34.sslip.io`.

Make a password (letters and digits only, so it can go inside a URL without escaping) and its hash:

```bash
cd ~/delivery-planner/infra/routing/oracle
docker run --rm caddy:2.8.4 caddy hash-password --plaintext 'YourLongPassword123'
cp .env.example .env
nano .env        # ROUTING_HOST, ACME_EMAIL, ROUTING_USER, ROUTING_PASSWORD_HASH (keep the single quotes)
docker compose up -d
docker compose logs -f caddy     # wait for "certificate obtained successfully", then Ctrl+C
```

## 5. Test from anywhere

```bash
# OSRM: a short ride in central Dublin -> "code":"Ok"
curl -u routify:YourLongPassword123 "https://140-238-12-34.sslip.io/osrm/route/v1/bike/-6.2603,53.3498;-6.2550,53.3440?overview=false"

# VROOM: a sample problem -> "code":0
curl -u routify:YourLongPassword123 -X POST "https://140-238-12-34.sslip.io/vroom" \
  -H "Content-Type: application/json" -d @../bench/sample-vroom.json

# Without the password -> 401
curl -o /dev/null -w "%{http_code}\n" "https://140-238-12-34.sslip.io/osrm/route/v1/bike/-6.26,53.35;-6.25,53.34"
```

## 6. Point the backend at it

**Render** → the `routify-api` service → **Environment** → add, then **Save** (Render redeploys):

| Key | Value |
|---|---|
| `ROUTING_PROVIDER` | `osrm` |
| `OSRM_URL` | `https://routify:YourLongPassword123@140-238-12-34.sslip.io/osrm` |
| `OSRM_PROFILE` | `bike` |
| `VROOM_URL` | `https://routify:YourLongPassword123@140-238-12-34.sslip.io/vroom` |
| `VROOM_PROFILE` | `bike` |

The same five lines go in `backend-py/.env` to use it from a local backend. Without `VROOM_URL` the backend orders
stops with its own optimiser on OSRM's road distances; with it, VROOM does (and the backend falls back to its own
optimiser if VROOM is down).

## Everyday

| Task | Command (in `~/delivery-planner/infra/routing`) |
|---|---|
| Status | `docker compose -f oracle/docker-compose.yml ps` |
| Logs | `docker compose -f oracle/docker-compose.yml logs -f osrm` |
| Refresh the map (monthly) | `REFRESH=1 ./scripts/prepare-ireland.sh && docker compose -f oracle/docker-compose.yml restart osrm` |
| Change the password | new hash in `oracle/.env`, `docker compose -f oracle/docker-compose.yml up -d caddy`, update Render's URLs |
| Stop everything | `docker compose -f oracle/docker-compose.yml down` |

All services restart by themselves after a reboot (`restart: unless-stopped`).

## Free tier: things to know

- **Home region only:** Always Free instances and volumes must be in your tenancy's home region (chosen at sign-up).
- **Idle reclaim:** Oracle may reclaim an Always Free instance that is idle for 7 days: CPU (95th percentile),
  network *and* memory all under 20%. With Britain + Ireland loaded, OSRM alone keeps memory above that; with only
  Ireland and no use for a week it could fall under it. **Upgrading the account to Pay As You Go** stops idle reclaim
  and still charges nothing while you stay within the Always Free limits (set a budget alert to be safe).
- **Out of capacity:** free Ampere capacity is sometimes full; retry later or in another availability domain.

## Moving to the client's hosting later

Any Linux server with Docker: copy `infra/routing` (including `data/`, or build the map there with step 3), repeat
step 4 with the new name, and change the two URLs in the backend's environment. Nothing in the app changes.
