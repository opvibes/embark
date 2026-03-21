# Changelog

## [1.5.0](https://github.com/opvibes/embark/compare/v1.4.0...v1.5.0) (2026-03-21)


### Features

* adicionar Cloudflare Workers como deploy target ([c957d41](https://github.com/opvibes/embark/commit/c957d415abf3df554dcb4fd0ffb5c9a129c193dc))
* sync automático do workflow ao alterar .embark.jsonc ([cdb44a6](https://github.com/opvibes/embark/commit/cdb44a647eb43bb591d01c527049a8f3d9bee4e3))


### Bug Fixes

* adicionar path do gitlink no filtro de paths para submodules ([3ab7e9a](https://github.com/opvibes/embark/commit/3ab7e9a4b8608c030ac995fc2e8745006052d1a2))
* corrigir endpoint de custom domain no template CF Workers ([3927e87](https://github.com/opvibes/embark/commit/3927e87d4f7deee684f5de4e1e03c992e51a63a7))
* corrigir sync-workflows e remover push automático no post-commit ([fa55b7b](https://github.com/opvibes/embark/commit/fa55b7b039e596a832aa0231b5f5be6c7a88bf66))
* limpar DNS records conflitantes antes de configurar custom domain ([9c13ea9](https://github.com/opvibes/embark/commit/9c13ea96c66ecdba0bc7603a01e877cffe84e07d))
* remover build/artifact do template de Cloudflare Workers ([d793257](https://github.com/opvibes/embark/commit/d793257895e18c19fcb6f2bd679511ce2b9d351a))
* remover SITE_UPDATE_REQUEST.md do repo core ([85cae8e](https://github.com/opvibes/embark/commit/85cae8e80efc979101b3d60ea6ef7fc3df5f0596))
* simplificar DNS step do CF Workers template ([05d8d2b](https://github.com/opvibes/embark/commit/05d8d2b45ba024237c5c9e663f01e216dd5bfe6d))
* verificar se custom domain ja existe antes de criar ([0b4974b](https://github.com/opvibes/embark/commit/0b4974b7b1377e89e5ee1bc7c913b95ebf1c6a76))

## [1.4.0](https://github.com/opvibes/embark/compare/v1.3.0...v1.4.0) (2026-03-13)


### Features

* cleaner baseado em cloud APIs e remoção de pacotes deletados do apps.jsonc ([cfc4956](https://github.com/opvibes/embark/commit/cfc49564f2d597732461ccdb425c831a9e349328))
* cleaner multi-target e reset de releases ([f1fcfac](https://github.com/opvibes/embark/commit/f1fcfacc36650d8bc0647bd0c2f28b2dbaabda89))


### Bug Fixes

* corrigir passagem de JSON multiline no cleaner workflow ([2562a0f](https://github.com/opvibes/embark/commit/2562a0f0584f4ef8a7ada01678aaabe8b8ac27fd))

## Changelog
