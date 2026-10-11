# LEGACY (pre-ElevenLabs pipeline; kept until the ElevenLabs pipeline passes P2 + one new episode). Do not build new episodes on this. (Windows SAPI)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$voiceSource=@'
using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Synthesis;
using System.Speech.AudioFormat;
public static class P2V4Speech {
 public static void Render(string voice, int rate, string text, string file) {
  using(var synth=new SpeechSynthesizer()) {
   synth.SelectVoice(voice); synth.Rate=rate;
   var words=new List<string>();
   synth.SpeakProgress+=(s,e)=>words.Add(e.AudioPosition.TotalSeconds.ToString("R",CultureInfo.InvariantCulture)+"\t"+e.CharacterPosition+"\t"+e.CharacterCount+"\t"+e.Text);
   synth.SetOutputToWaveFile(file,new SpeechAudioFormatInfo(16000,AudioBitsPerSample.Sixteen,AudioChannel.Mono)); synth.Speak(text); synth.SetOutputToNull();
   File.WriteAllLines(file+".words.tsv",words);
  }
 }
}
'@
Add-Type -TypeDefinition $voiceSource -ReferencedAssemblies System.Speech
$copy=Get-Content -Encoding UTF8 -LiteralPath 'scripts/video/p2-v4-copy.json' -Raw | ConvertFrom-Json
$audioRoot=Join-Path (Get-Location) 'docs/p2-v4/voice'
New-Item -ItemType Directory -Force -Path $audioRoot | Out-Null
foreach($line in $copy.lines) {
 $voiceName=if($line.lang -eq 'en') {'Microsoft Zira Desktop'} else {'Microsoft Hanhan Desktop'}
 $voiceRate=0
 $target=Join-Path $audioRoot ($line.id+'.wav')
 [P2V4Speech]::Render($voiceName,$voiceRate,$line.text,$target)
 Write-Output ($line.id+' / '+$voiceName)
}
