from glob import glob
import re,os

devset = ["GUM_academic_exposure","GUM_academic_librarians","GUM_bio_byron","GUM_bio_emperor","GUM_conversation_grounded","GUM_conversation_risk","GUM_court_loan","GUM_court_negligence","GUM_essay_evolved","GUM_essay_tools","GUM_fiction_beast","GUM_fiction_lunre","GUM_interview_cyclone","GUM_interview_gaming","GUM_letter_arendt","GUM_letter_wiki","GUM_news_homeopathic","GUM_news_iodine","GUM_podcast_bangladesh","GUM_podcast_wrestling","GUM_reddit_macroeconomics","GUM_reddit_pandas","GUM_speech_impeachment","GUM_speech_inauguration","GUM_textbook_governments","GUM_textbook_labor","GUM_vlog_portland","GUM_vlog_radiology","GUM_voyage_athens","GUM_voyage_coron","GUM_whow_joke","GUM_whow_overalls"]
testset = ["GUM_academic_discrimination","GUM_academic_eegimaa","GUM_bio_dvorak","GUM_bio_jespersen","GUM_conversation_lambada","GUM_conversation_retirement","GUM_court_insanity","GUM_court_mitigation","GUM_essay_fear","GUM_essay_system","GUM_fiction_falling","GUM_fiction_teeth","GUM_interview_hill","GUM_interview_libertarian","GUM_letter_attorney","GUM_letter_mandela","GUM_news_nasa","GUM_news_sensitive","GUM_podcast_bezos","GUM_podcast_multitasking","GUM_reddit_escape","GUM_reddit_monsters","GUM_speech_austria","GUM_speech_newzealand","GUM_textbook_chemistry","GUM_textbook_union","GUM_vlog_london","GUM_vlog_studying","GUM_voyage_oakland","GUM_voyage_vavau","GUM_whow_cactus","GUM_whow_mice"]

files = glob("_build/src/xml/*.xml")  # Path to GUM repo _build/src/xml/*.xml

output = {"train":[],"dev":[],"test":[]}
for f in files:
    docname = os.path.basename(f).replace(".xml","")
    partition = "train"
    if docname in devset:
        partition = "dev"
    elif docname in testset:
        partition = "test"
    lines = open(f).readlines()

    words = []
    stype = ""
    for line in lines:
        if "<s type" in line:
            stype = re.search(r' type="([^"]*)"', line).group(1)
        elif "\t" in line:
            words.append(line.split("\t")[0])
        elif "</s>" in line:
            output[partition].append(f"{stype}\t{' '.join(words)}")
            words = []
            stype = ""

for partition in ["train","dev","test"]:
    with open(f"stype_{partition}.tab",'w',encoding="utf-8", newline="\n") as f:
        f.write("\n".join(output[partition]))