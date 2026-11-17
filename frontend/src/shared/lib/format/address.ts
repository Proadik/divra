/** «7xQpZk…3kF2» — первые и последние символы адреса. */
export const shortenAddress = (address: string, head = 4, tail = 4): string =>
  address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`
