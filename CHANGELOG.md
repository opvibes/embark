# Changelog

## [1.2.0](https://github.com/opvibes/embark/compare/v1.1.0...v1.2.0) (2026-03-12)


### Features

* **fork:** suporte a uso como fork com sync de upstream ([d73ccb2](https://github.com/opvibes/embark/commit/d73ccb2eaa3b046f458410bfc5272b0bca85fdaf))
* **site:** nav completa com dropdowns, footer rico e fixes ([17c078b](https://github.com/opvibes/embark/commit/17c078b77aa0ec074eec2306991f56f9cc2c403a))
* **utils:** unificar scripts em uma CLI interativa ([2c38703](https://github.com/opvibes/embark/commit/2c38703299033fd5ec80b9a472f62b8abeefd1c4))


### Bug Fixes

* dropdown sem gap e teste sync-upstream isolado ([d954598](https://github.com/opvibes/embark/commit/d954598cf036062f0a020399a4716983add1619e))
* **sync-workflows:** passar useSubmodule ao gerar conteúdo esperado ([7347413](https://github.com/opvibes/embark/commit/734741318736a56ae4718d552f9c60c8c9c756e6))

## [1.1.0](https://github.com/opvibes/embark/compare/v1.0.1...v1.1.0) (2026-03-12)


### Features

* separar workflows em jobs por etapa com passagem segura de variáveis ([763b744](https://github.com/opvibes/embark/commit/763b744eca4ac7598be3cc405a8c614bc8ebc89d))
* separar workflows em jobs por etapa com passagem segura de vars ([0bebe8d](https://github.com/opvibes/embark/commit/0bebe8dee9b107245c906b4c043b6ac8cfb86dfe))
* **ui:** versão badge com círculo animado e estilos aprimorados ([3e94347](https://github.com/opvibes/embark/commit/3e943479011fcf32512a011fc648f55c1c72495e))

## [1.0.1](https://github.com/opvibes/embark/compare/v1.0.0...v1.0.1) (2026-03-12)


### Bug Fixes

* reduzir version badge e estilizar scrollbar global ([18b88c9](https://github.com/opvibes/embark/commit/18b88c9026e8c96f6310af2257aba331c0239d5a))
* tratar resposta vazia da API Cloudflare antes de parsear com jq ([54d552c](https://github.com/opvibes/embark/commit/54d552c2107cf61f77e474452b56a9bd4f40362b))
* version badge minimalista no estilo tag do GitHub ([609571b](https://github.com/opvibes/embark/commit/609571b35d7824252efb789294a949b1c1981acb))

## 1.0.0 (2026-03-12)


### Features

* adicionar folderName ao apps.jsonc e workflow cleaner do Cloudflare ([bcc46e9](https://github.com/opvibes/embark/commit/bcc46e94da06cb5c1acc2c5eac99c106073cf1cd))
* adicionar release automático com semver e badge de versão no nav ([48d866a](https://github.com/opvibes/embark/commit/48d866a8cc620ca19c7446526480d08f5534e84a))
* adicionar useSubmodule ao create-package e atualizar simulador ([5987913](https://github.com/opvibes/embark/commit/59879136d3f65b54ca24db6a57df1a5160940cc8))
* commitlint, reorder submodule question, fix cursor z-index and hamburger X ([7e276ef](https://github.com/opvibes/embark/commit/7e276efdcd054c72fc2d879843f6278c72470797))
* mover pergunta de submodule para o fluxo de info do pacote e atualizar site ([46f71ed](https://github.com/opvibes/embark/commit/46f71ede6946f0e060632385a26e0fff31a0813e))
* submodule support, sanitização de subdomain com pontos e workflow cleaner ([5ed5831](https://github.com/opvibes/embark/commit/5ed5831520fa19e61568d1d911e1a221fa58fb64))


### Bug Fixes

* accept . in subdomain ([f9d1cbb](https://github.com/opvibes/embark/commit/f9d1cbb1bda23ceb0a2e14a2245bcc4ec19ed6c3))
* proteger release.yml de deleção pelo cleanup-orphan ([d1900f1](https://github.com/opvibes/embark/commit/d1900f19d8765713c4668009ac29515e7cec67a2))
