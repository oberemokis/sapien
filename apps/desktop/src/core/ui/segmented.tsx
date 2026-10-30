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
    <fieldset className="flex rounded-lg border border-stroke p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="cursor-default rounded-md px-2.5 py-1 text-[13px] text-content/60 transition-colors duration-120 hover:text-content has-checked:bg-selection-strong has-checked:text-content has-focus-visible:outline-2 has-focus-visible:outline-accent"
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
