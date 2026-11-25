from .assistant_model import clean
from .science.crops import STAGE_LABELS
from .science.weather import field_weather_risks

STAGES = {
    "en": (*STAGE_LABELS, "Pre-planting", "Beyond modeled season"),
    "ur": ("ابتدائی", "نشوونما", "درمیانی مرحلہ", "آخری مرحلہ", "بوائی سے پہلے", "تخمینی موسم مکمل"),
    "roman_ur": ("Ibtidai", "Nashonuma", "Darmiyani marhala", "Aakhri marhala", "Buwai se pehle", "Andazay ka season mukammal"),
}


def stage_name(language, stage):
    return dict(zip(STAGES["en"], STAGES[language], strict=True)).get(stage, stage)

COPY = {
    "en": {
        "verify": "AquaProof verification. In WhatsApp, use Reply on this message and type YES to confirm your number and opt in to farm updates.",
        "verified": "Your WhatsApp number is verified. Use Reply on this message to ask about your farm or report irrigation, rain, or soil conditions.",
        "clarify": "Please tell us which field you mean and what you want to check. Include the verification line from this message.",
        "observation": "We received your field report. An officer will verify it before it updates the farm record.",
        "review": "An agriculture officer needs to review this request. Wait for their guidance before changing irrigation.",
        "missing_prefix": "AquaProof needs updated information before it can advise.",
        "missing": {"crop": "Confirm crop and planting date.", "measurements": "Ask the officer to record current soil-water measurements.",
                    "supply": "Confirm canal or pump availability and measured flow.", "weather": "Reliable current forecasts are unavailable.",
                    "season": "Confirm that the crop is still in season."},
        "no_water": "Today's model does not recommend additional irrigation. Check actual soil moisture before changing your schedule.",
        "turn": "Use canal water only during your registered Warabandi turn.",
        "weather": ("Rain is forecast. Recheck the forecast and field moisture before watering.",
                    "The forecast shows no rain. Check the root-zone soil before watering.",
                    "The forecast does not give a clear rain outlook. Check the soil before deciding."),
        "weather_risks": {"heat": "Very hot weather is possible. Check the crop for wilting in the cooler part of the day.",
                          "frost": "Frost is possible. Check sheltered and low-lying patches for damage.",
                          "heavy_rain": "Heavy rain is possible. Clear field drains where it is safe to do so."},
        "history": "Your field has approved irrigation or condition reports. Check current soil moisture before relying on past reports.",
        "no_history": "There are no approved irrigation or condition reports for this field yet.",
        "crop": "Estimated crop stage: {stage}. Walk the field and check for uneven growth, yellow leaves, and standing water. Confirm the stage in the field.",
        "outlook": "Over the next few days, recheck the forecast and feel the soil below the surface before each irrigation turn.",
        "pump": "If the soil around the roots is dry, check the pump flow and apply water evenly. Stop if water starts to pool or run off.",
        "tips": {"check_soil":"Check the root-zone soil before irrigating.", "check_water_supply":"Confirm local water is available.",
                 "inspect_drainage":"Check whether field drains are clear."},
    },
    "ur": {
        "verify": "واٹس ایپ میں اسی پیغام پر جواب دیں اور ہاں لکھیں۔ اس سے آپ کے نمبر اور زرعی اطلاعات کی رضامندی کی تصدیق ہوگی۔",
        "verified": "آپ کے واٹس ایپ نمبر کی تصدیق ہو گئی ہے۔ کھیت کے بارے میں سوال یا رپورٹ کے لیے اسی پیغام کا جواب دیں۔",
        "clarify": "براہ کرم کھیت کا نام اور اپنا سوال بتائیں۔ اس پیغام کی تصدیقی سطر بھی ساتھ لکھیں۔",
        "observation": "آپ کی رپورٹ مل گئی ہے۔ ریکارڈ میں شامل کرنے سے پہلے افسر تصدیق کرے گا۔",
        "review": "زرعی افسر اس معاملے کا جائزہ لے گا۔ آبپاشی تبدیل کرنے سے پہلے ان کی ہدایت کا انتظار کریں۔",
        "missing_prefix": "آبپاشی کے مشورے کے لیے تازہ معلومات درکار ہیں۔",
        "missing": {"crop":"فصل اور بوائی کی تاریخ بتائیں۔", "measurements":"افسر سے مٹی میں موجود پانی کی تازہ پیمائش درج کروائیں۔",
                    "supply":"نہری یا ٹیوب ویل کے پانی اور بہاؤ کی تصدیق کریں۔", "weather":"تازہ قابل اعتماد موسم دستیاب نہیں۔",
                    "season":"تصدیق کریں کہ فصل ابھی موسم میں ہے۔"},
        "no_water": "آج کے حساب کے مطابق اضافی آبپاشی درکار نہیں ہے۔ شیڈول بدلنے سے پہلے مٹی کی نمی دیکھیں۔",
        "turn": "نہری پانی صرف درج شدہ وارہ بندی کی باری میں استعمال کریں۔",
        "weather": ("بارش متوقع ہے۔ پانی لگانے سے پہلے تازہ پیش گوئی اور کھیت کی نمی دوبارہ دیکھیں۔",
                    "پیش گوئی میں بارش متوقع نہیں۔ پانی لگانے سے پہلے جڑوں کے پاس مٹی کی نمی دیکھیں۔",
                    "پیش گوئی میں بارش کی صورتِ حال واضح نہیں۔ فیصلہ کرنے سے پہلے مٹی کی نمی دیکھیں۔"),
        "weather_risks": {"heat": "شدید گرمی کا امکان ہے۔ دن کے ٹھنڈے وقت دیکھیں کہ فصل مرجھا تو نہیں رہی۔",
                          "frost": "پالا پڑ سکتا ہے۔ کھیت کے نشیبی حصوں میں فصل کو نقصان کے لیے دیکھیں۔",
                          "heavy_rain": "تیز بارش کا امکان ہے۔ جہاں محفوظ ہو وہاں نکاسی کے راستے صاف رکھیں۔"},
        "history": "آپ کے کھیت کی آبپاشی یا حالت کے منظور شدہ ریکارڈ موجود ہیں۔ پرانی رپورٹ پر عمل کرنے سے پہلے موجودہ نمی دیکھیں۔",
        "no_history": "اس کھیت کی آبپاشی یا حالت کی کوئی منظور شدہ رپورٹ ابھی درج نہیں۔",
        "crop": "فصل کا اندازاً مرحلہ: {stage}۔ کھیت کا چکر لگا کر غیر یکساں بڑھوتری، زرد پتے اور کھڑا پانی دیکھیں۔ فصل کے اصل مرحلے کی تصدیق کھیت میں کریں۔",
        "outlook": "اگلے چند دن ہر باری سے پہلے تازہ موسم دیکھیں اور سطح کے نیچے مٹی کو ہاتھ سے دیکھ کر نمی جانچیں۔",
        "pump": "اگر جڑوں کے پاس مٹی خشک ہو تو ٹیوب ویل کا بہاؤ دیکھ کر پانی یکساں لگائیں۔ پانی کھڑا ہو یا بہہ نکلے تو روک دیں۔",
        "tips": {"check_soil":"پانی لگانے سے پہلے چند جگہ سطح کے نیچے جڑوں کے پاس مٹی ہاتھ میں لے کر نمی دیکھیں۔", "check_water_supply":"پانی دستیاب ہونے کی تصدیق کریں۔",
                 "inspect_drainage":"پانی کی نکاسی کے راستے چیک کریں۔"},
    },
    "roman_ur": {
        "verify": "WhatsApp par is paigham ka Reply de kar YES likhein. Is se aap ke number aur kheti ki updates ki razamandi ki tasdeeq hogi.",
        "verified": "Aap ka WhatsApp number tasdeeq ho gaya. Khet ka sawal ya report bhejne ke liye is paigham ka Reply dein.",
        "clarify": "Khet ka naam aur apna sawal batayein. Is paigham ki tasdeeqi line bhi sath likhein.",
        "observation": "Aap ki report mil gayi. Officer tasdeeq ke baad isay record mein shamil karega.",
        "review": "Zarai officer iska jaiza lega. Pani ka faisla badalne se pehle rehnumai ka intezar karein.",
        "missing_prefix": "Pani ka mashwara dene ke liye nayi maloomat chahiye.",
        "missing": {"crop":"Fasal aur buwai ki tareekh batayein.", "measurements":"Officer se mitti ke pani ki nayi paimaish darj karwayein.",
                    "supply":"Nehri ya tubewell ka pani aur bahaao tasdeeq karein.", "weather":"Bharosemand taza mausam dastiyab nahin.",
                    "season":"Tasdeeq karein ke fasal abhi season mein hai."},
        "no_water": "Aaj ke hisaab mein mazeed pani ki zaroorat nahin. Schedule badalne se pehle mitti ki nami dekhein.",
        "turn": "Nehri pani sirf darj shuda warabandi ki bari mein lagayein.",
        "weather": ("Barish mutawaqqa hai. Pani lagane se pehle taza peshgoi aur khet ki nami dobara dekhein.",
                    "Peshgoi mein barish mutawaqqa nahin. Pani se pehle jarron ke paas mitti ki nami dekhein.",
                    "Peshgoi mein barish ki surat-e-haal wazeh nahin. Faislay se pehle mitti ki nami dekhein."),
        "weather_risks": {"heat": "Sakht garmi mumkin hai. Thanday waqt dekhein ke fasal murjha to nahin rahi.",
                          "frost": "Pala par sakta hai. Khet ke neechay walay hisson mein nuqsan dekhein.",
                          "heavy_rain": "Tez barish mumkin hai. Jahan mehfooz ho nikaas ke rastay saaf rakhein."},
        "history": "Aap ke khet ki aabpashi ya halat ki manzoor shuda reports mojood hain. Purani report par amal se pehle aaj ki nami dekhein.",
        "no_history": "Is khet ki aabpashi ya halat ki koi manzoor shuda report abhi darj nahin.",
        "crop": "Fasal ka andazay ka marhala: {stage}. Khet mein jagah jagah barhotri, peelay pattay aur khara pani dekhein.",
        "outlook": "Aglay chand din har bari se pehle taza mausam aur satah ke neechay mitti ki nami dekhein.",
        "pump": "Agar jarron ke paas mitti khushk ho to pump ka bahao dekhein aur pani barabar lagayein. Pani khara ho ya beh niklay to rok dein.",
        "tips": {"check_soil":"Pani lagane se pehle jarron ki mitti dekhein.", "check_water_supply":"Pani ki dastiyabi tasdeeq karein.",
                 "inspect_drainage":"Pani ke nikaas ke raste check karein."},
    },
}


def template(language, key):
    return COPY[language][key]


def field_message(farm_name, body):
    name = " ".join(clean(farm_name).split())
    return f"{name}\n{body}"


APPROVED_SOIL = {
    "en": {"dry": "dry", "moist": "moist", "waterlogged": "waterlogged"},
    "ur": {"dry": "خشک", "moist": "نم", "waterlogged": "پانی میں ڈوبی ہوئی"},
    "roman_ur": {"dry": "khushk", "moist": "nam", "waterlogged": "pani mein doobi hui"},
}


def history_report(language, records):
    for row in records["observations"]:
        data = row["measurements"]
        soil = APPROVED_SOIL[language].get(data.get("soil"))
        if soil:
            return {
                "en": f"The latest approved soil report described it as {soil}. Check current moisture in several spots.",
                "ur": f"تازہ ترین منظور شدہ رپورٹ میں مٹی {soil} بتائی گئی تھی۔ اب چند جگہ مٹی کی نمی دیکھیں۔",
                "roman_ur": f"Nayi manzoor shuda report mein mitti {soil} thi. Ab chand jagah nami dekhein.",
            }[language]
    return template(language, "history" if any(records.values()) else "no_history")


def profile_report(language, profile):
    labels = {
        "en": ("Recorded crop", "Soil type", "Water source"),
        "ur": ("درج شدہ فصل", "مٹی کی قسم", "پانی کا ذریعہ"),
        "roman_ur": ("Darj shuda fasal", "Mitti ki qisam", "Pani ka zariya"),
    }
    urdu_names = {
        "wheat": "گندم", "maize": "مکئی", "rice": "چاول", "cotton": "کپاس",
        "sugarcane": "گنا", "vegetables": "سبزیاں", "canal": "نہر", "tubewell": "ٹیوب ویل",
        "canal + tubewell": "نہر اور ٹیوب ویل", "rain-fed": "بارانی",
        "loam": "میرا مٹی", "sandy loam": "ریتلی میرا مٹی",
        "silt loam": "سلٹی میرا مٹی", "clay loam": "چکنی میرا مٹی",
    }
    lines = []
    for label, key in zip(labels[language], ("crop", "soil", "source"), strict=True):
        value = profile[key]
        if value:
            name = urdu_names.get(value.casefold(), value) if language == "ur" else value
            lines.append(f"{label} · {' '.join(clean(name).split())}")
    return "\n".join([*lines, COPY[language]["tips"]["check_soil"]])


def report(language, farm_name, evidence, tip="none"):
    copy = COPY[language]
    if evidence.get("missing"):
        content = " ".join(copy["missing"][key] for key in evidence["missing"])
        return field_message(farm_name, f"{copy['missing_prefix']} {content} {copy['tips']['check_soil']}")
    today = evidence["today"]
    name = f"{farm_name} · {stage_name(language, today['stage'])}"
    data = evidence["forecast"]["daily"][0]
    forecast = weather_report(language, data)
    if not today["canal_m3"] and not today["pump_m3"]:
        precaution = copy["tips"].get(tip)
        return field_message(name, f"{copy['no_water']}\n{forecast}" + (f"\n{precaution}" if precaution else ""))
    pieces = [forecast]
    if today["canal_m3"]:
        pieces.append(copy["turn"])
    if today["pump_m3"] and evidence["pump"]:
        pieces.append(copy["pump"])
    if tip in copy["tips"]:
        pieces.append(copy["tips"][tip])
    return field_message(name, "\n".join(pieces))


def weather_report(language, row):
    rain, dry, unclear = COPY[language]["weather"]
    if (row.get("rain_mm") or 0) > 0 or (row.get("precip_probability_pct") or 0) > 0:
        outlook = rain
    else:
        outlook = dry if row.get("rain_mm") == 0 and row.get("forecast_periods", 8) == 8 else unclear
    risks = COPY[language]["weather_risks"]
    return " ".join([outlook, *(risks[risk] for risk in field_weather_risks([row]))])


def outlook(language, evidence):
    plan = evidence["plan"]
    rows = [COPY[language]["outlook"]]
    upcoming = plan["plans"][plan["recommended"]]["daily"][:3]
    if any(day["canal_m3"] for day in upcoming):
        rows.append(COPY[language]["turn"])
    return "\n".join(rows)
