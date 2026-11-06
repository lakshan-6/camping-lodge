// Keep identifiers as text so leading zeroes are preserved.
export function PhoneInput({ value, onChange, ...props }) {
  return <input {...props} type="tel" inputMode="numeric" autoComplete="tel"
    pattern="[0-9]{10,15}" minLength={10} maxLength={15}
    title="Enter 10 to 15 digits only, for example 0771234567 or 94771234567"
    placeholder="0771234567" value={value || ''}
    onChange={e => { if (/^[0-9]{0,15}$/.test(e.target.value)) onChange(e.target.value); }} />;
}

export function NicInput({ value, onChange, ...props }) {
  return <input {...props} type="text" autoCapitalize="characters" spellCheck={false}
    pattern="[0-9]{9}[VvXx]|[0-9]{12}" maxLength={12}
    title="Enter 12 digits, or 9 digits followed by V or X"
    placeholder="123456789V or 200012345678" value={value || ''}
    onChange={e => {
      const next = e.target.value.toUpperCase();
      if (/^[0-9]{0,12}$/.test(next) || /^[0-9]{9}[VX]$/.test(next)) onChange(next);
    }} />;
}
