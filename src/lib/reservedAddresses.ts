export const RESERVED_ADDRESSES = new Map<string, string>([
  [
    "ecash:qq7qn90ev23ecastqmn8as00u8mcp4tzsspvt5dtlk",
    "xolosArmy Treasury"
  ]
]);

export function getReservedAddressLabel(address: string): string | null {
  return RESERVED_ADDRESSES.get(address.toLowerCase()) ?? null;
}
