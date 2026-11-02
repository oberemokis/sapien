import { useId } from "react";

type Props<Value extends string> = {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
};

// Выбор одного из нескольких вариантов в ряд. Под видом лежат обычные
// радиокнопки: стрелки, фокус и чтение с экрана браузер даёт сам.
export function Segmented<Value extends string>({ label, value, options, onChange }: Props<Value>) {
  const name = useId();

  return (
    <fieldset className="flex h-7 rounded-md bg-bg-layer-01 shadow-[0_0_0_0.5px_var(--border-border-base)]">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-default items-center rounded-md px-3 text-[13px]/4 text-text-muted transition-colors duration-120 hover:text-text-base has-checked:bg-bg-base has-checked:text-text-base has-checked:shadow-[0_0_0_0.5px_var(--border-border-strong)] has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-border-focus"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
