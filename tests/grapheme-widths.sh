# Some tests for Grapheme Clusters and Wide characters
# With no options, in "demo" mode.
# With "--tests" option, more extensive/tedious tests

if test "$1" != "--tests"
then
show() {
    echo -e "{$1} $2"
}
else
# Tabs (followed by '#') are used to verify correct width.
echo -e '12345678123456781234567812345678\r\t|\t|\t|'
show() {
    # Test data at end of output:
    echo -e "{$1}\t|$2"
    # Test overwriting existing characters:
    echo -e "12345678123456781234\r{$1}\t|$2"
}
fi

show "\U1F1F3\U1F1F4" "REGIONAL INDICATOR SYMBOL LETTER N × RI O"
show "\U1F476\U1F3FF\U1F476" "baby × emoji modifier fitzpatrick type-6 ÷ baby"
show "\U1F476\U1F476\U1F3FFX" ''
show '\U0061\U0301'  'letter a × acute accent'
show '\U1100\U1161\U11A8' 'Hangul syllables (correct on Firefox)'
show '\U1F469\U200D\U1F469\U200D\U1F466' 'woman+zwj+woman+zwj+boy'
show '\U1F926\U1F3FC\U200D\U2642\UFE0F' 'face palm × fitzpatrick type-3 × zwj × male × emoji presentation'
show '\U1F469' 'woman'
show 'x哀公' ''
show '哀公xy問' ''
show '\U26b0\U26b0' 'coffin coffin'
show '\U26b0\Ufe0E' 'coffin text_presentation'
show '\U26b0\Ufe0f' 'coffin emoji_presentation'
show 'E\u0301\ufe0fg\ufe0fa\ufe0fl\ufe0fi\ufe0f\ufe0ft\ufe0fe\u0301\ufe0f' 'Égalité (using separate acute) emoij_presentation'
if test "$1" == "--tests"
then
show "\U1F1F3\U1F1F4\U1F1E8\U0062" "regional indicator symbol letter N (RI) × RI O ÷ RI C ÷ latin small letter b)"
show '\U1F469\U200D\U1F469\U200D\U1F467\U200D\U1F466' 'woman+zwj+woman+zwj+girl+zwj+boy'
fi
