"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import { composeSpeechInput } from "@/lib/speech-input";
import { joinReflectionParts, REFLECTION_STAGE_LABELS, splitReflectionText } from "@/lib/reflection";
import styles from "./reflection-panel.module.css";

interface ReflectionTriptychProps {
  idPrefix: string;
  value: string;
  questions: readonly [string, string, string];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ReflectionTriptych({ idPrefix, value, questions, onChange, disabled = false }: ReflectionTriptychProps) {
  const parts = useMemo(() => splitReflectionText(value), [value]);
  const fields = useRef<Array<HTMLTextAreaElement | null>>([]);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const speechBase = useRef("");
  const speechValue = useRef("");
  const speechFailed = useRef(false);
  const [listening, setListening] = useState<number | null>(null);
  const [voiceMessage, setVoiceMessage] = useState("");

  useEffect(() => () => { recognition.current?.stop(); recognition.current = null; }, []);

  function focusNext(index: number) {
    if (index >= 2) return;
    window.setTimeout(() => fields.current[index + 1]?.focus(), 0);
  }

  function updatePart(index: number, nextValue: string) {
    const next = [...parts];
    const segments = nextValue.replace(/\r\n?/g, "\n").split("\n");
    next[index] = segments[0];
    if (segments.length > 1) {
      for (let offset = 1; offset < segments.length && index + offset < 3; offset += 1) {
        next[index + offset] = index + offset === 2 ? segments.slice(offset).join(" ") : segments[offset];
      }
      focusNext(Math.min(index + segments.length - 2, 1));
    }
    onChange(joinReflectionParts(next));
  }

  function toggleVoice(index: number) {
    if (recognition.current) { recognition.current.stop(); return; }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) { setVoiceMessage("当前浏览器不支持语音输入，可以直接打字。"); return; }
    const instance = new Constructor();
    speechBase.current = parts[index].trim() ? `${parts[index].trim()} ` : "";
    speechValue.current = parts[index];
    speechFailed.current = false;
    instance.lang = "zh-CN";
    instance.continuous = false;
    instance.interimResults = true;
    instance.onresult = event => {
      const next = composeSpeechInput(speechBase.current, event.results);
      speechValue.current = next;
      updatePart(index, next);
    };
    instance.onerror = event => {
      speechFailed.current = true;
      setVoiceMessage(event.error === "not-allowed" ? "请允许麦克风权限后再试。" : "这次没有听清，可以再说一次。");
      setListening(null);
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(null);
      if (!speechFailed.current && speechValue.current.trim()) focusNext(index);
    };
    recognition.current = instance;
    setVoiceMessage("");
    try { instance.start(); setListening(index); }
    catch { recognition.current = null; setListening(null); setVoiceMessage("语音暂时无法启动，可以先打字。"); }
  }

  return <div className={styles.reflectionGrid}>
    {parts.map((part, index) => <div className={styles.reflectionField} key={index} data-active={listening === index}>
      <span className={styles.fieldTop}><span className={styles.fieldIndex}>0{index + 1}</span><span className={styles.fieldLabel}>{REFLECTION_STAGE_LABELS[index]}</span></span>
      <label className={styles.guidingQuestion} htmlFor={`${idPrefix}-${index}`}>{questions[index]}</label>
      <span className={styles.lineShell}>
        <textarea ref={element => { fields.current[index] = element; }} id={`${idPrefix}-${index}`} rows={2} value={part}
          aria-label={index === 0 ? "我自己的理解" : `我的理解第 ${index + 1} 句`} maxLength={10_000} disabled={disabled}
          placeholder={index === 0 ? "我理解的是……" : index === 1 ? "它让我想到……" : "接下来，我想试试……"}
          onChange={event => updatePart(index, event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault(); focusNext(index);
          }} />
        <button type="button" className={styles.lineVoice} aria-label={listening === index ? `停止第 ${index + 1} 句语音输入` : `用语音回答第 ${index + 1} 个问题`}
          aria-pressed={listening === index} disabled={disabled || (listening !== null && listening !== index)} onClick={() => toggleVoice(index)}><AudioLines size={16} /><span className={styles.lineStrands} aria-hidden="true"><i /><i /><i /></span></button>
      </span>
    </div>)}
    <p className={styles.advanceHint}>按回车进入下一句，Shift + 回车可在当前栏换行。</p>
    {voiceMessage && <p className={styles.voiceMessage} role="status">{voiceMessage}</p>}
  </div>;
}
