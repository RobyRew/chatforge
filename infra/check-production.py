"""Validate rendered Compose on stdin without ever printing its secrets."""
import json
import os
import re
import sys
from urllib.parse import unquote, urlsplit


def check(config, ci=False):
    services = config['services']
    assert set(services) == {'postgres', 'garage', 'api', 'web'}, 'unexpected service set'
    for name, service in services.items():
        image = service['image']
        if ci:
            assert image == f'chatforge-{name}:ci', 'unexpected CI image'
        else:
            assert re.fullmatch(rf'ghcr\.io/robyrew/chatforge-{name}@sha256:[a-f0-9]{{64}}', image), 'image must use approved digest'
            assert not service.get('ports'), 'production must not publish host ports'
        assert not service.get('build'), 'production cannot build images'
        assert service.get('read_only') is True, 'writable root filesystem'
        assert service.get('cap_drop') == ['ALL'], 'capabilities must be dropped'
        assert 'no-new-privileges:true' in service.get('security_opt', []), 'privilege escalation protection missing'
        assert 0 < service.get('pids_limit', 0) <= 96, 'missing process limit'
        assert 0 < service.get('mem_limit', 0) <= 201326592, 'missing memory limit'
        assert not service.get('privileged'), 'privileged service forbidden'
    api, pg, garage = (services[name]['environment'] for name in ('api', 'postgres', 'garage'))
    assert api['NODE_ENV'] == 'production', 'production authentication mode required'
    assert not any(key.startswith('MINIO_') for key in api), 'administrator credential fallback forbidden'
    assert api['S3_ENDPOINT'] == 'http://garage:3900', 'unexpected object-store endpoint'
    for key in ('S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'):
        assert api[key] == garage[key], 'storage credential or bucket mismatch'
    assert len(garage['S3_SECRET_KEY']) >= 32, 'S3 secret too short'
    assert re.fullmatch('[a-f0-9]{64}', garage['GARAGE_RPC_SECRET']), 'RPC secret must be random 32-byte hex'
    assert len(pg['POSTGRES_PASSWORD']) >= 24, 'database password too short'
    database = urlsplit(api['DATABASE_URL'])
    assert database.hostname == 'postgres', 'unexpected database host'
    assert unquote(database.username or '') == pg['POSTGRES_USER'], 'database username mismatch'
    assert unquote(database.password or '') == pg['POSTGRES_PASSWORD'], 'database password mismatch'
    assert unquote(database.path.lstrip('/')) == pg['POSTGRES_DB'], 'database name mismatch'
    assert api['APP_BASE_URL'] == api['CORS_ORIGIN'], 'same-origin configuration required'
    if not ci:
        assert urlsplit(api['APP_BASE_URL']).scheme == 'https', 'HTTPS public origin required'
        assert urlsplit(api['LOGTO_ENDPOINT']).scheme == 'https', 'HTTPS issuer required'
        assert len(api['LOGTO_APP_SECRET']) >= 16, 'identity secret missing or too short'
    assert config['volumes']['chatforge-postgres']['external'] is True, 'existing external database volume required'
    assert config['networks']['storage']['internal'] is True, 'storage network must be internal'
    assert set(services['postgres']['networks']) == {'storage'}, 'database network exposure'
    assert set(services['garage']['networks']) == {'storage'}, 'storage network exposure'
    assert set(services['api']['networks']) == {'storage', 'application'}, 'API network exposure'
    assert set(services['web']['networks']) == {'application', 'dokploy-network'}, 'web network exposure'


if __name__ == '__main__':
    try:
        ci_mode = sys.argv[1:] == ['--ci'] and os.environ.get('GITHUB_ACTIONS') == 'true'
        assert not sys.argv[1:] or ci_mode, 'CI override requires disposable CI runner'
        check(json.load(sys.stdin), ci=ci_mode)
    except (AssertionError, KeyError, ValueError, TypeError):
        # Even malformed input can contain credentials. Never emit the exception or payload.
        sys.exit('Production configuration validation failed; inspect settings privately.')
    print('Production configuration checks passed; no secret values emitted.')
