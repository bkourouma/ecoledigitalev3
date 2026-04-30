# API Contracts: Imhotep Data Professional Training

**Date**: 2025-01-27  
**Feature**: 015-imhotep-data-schema  
**Phase**: 1 - Design & Contracts

## Status

**API contracts are out of scope for this feature phase.**

This feature focuses solely on database schema creation. API endpoints, request/response schemas, and Zod validation contracts will be defined in a future feature when implementing the application layer.

## Future Contracts

When implementing the API layer, contracts should be defined in `packages/contracts/src/` following the existing pattern:

### Expected Contract Files (Future)

- `packages/contracts/src/formations-professionnelles.ts` - Training program types
- `packages/contracts/src/sessions-professionnelles.ts` - Session types
- `packages/contracts/src/formateurs.ts` - Trainer types
- `packages/contracts/src/entreprises-clientes.ts` - Company client types
- `packages/contracts/src/inscriptions-professionnelles.ts` - Enrollment types
- `packages/contracts/src/codes-promo.ts` - Promotional code types
- `packages/contracts/src/paiements-professionnels.ts` - Payment types
- `packages/contracts/src/supports-cours.ts` - Training material types

### Contract Structure (Future)

Each contract file should include:
- Zod schemas for validation
- TypeScript types (inferred from Zod)
- Request/response DTOs
- Query parameter schemas
- Validation rules matching database constraints

## Database Schema Reference

For database schema details, see:
- [data-model.md](../data-model.md) - Complete entity definitions
- [research.md](../research.md) - Technical decisions and patterns

## Notes

- Database schema is complete and ready for migration
- API contracts will be created when implementing backend endpoints
- Frontend types will be generated from API contracts
- All contracts must follow constitution principles (type safety, validation)

