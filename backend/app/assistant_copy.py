from .assistant_model import clean

COPY = {
    "en": {
        "verify": "AquaProof verification. Reply to this email with the verification line below to confirm you control this mailbox and opt in to farm updates.",
        "verified": "Your AquaProof mailbox is verified. Reply with the new verification line when asking about your fields or reporting irrigation, rain, or soil conditions.",
        "clarify": "Please tell us which field you mean and what you want to check. Include the verification line from this message.",
        "observation": "We received your field report. An officer will verify it before it updates the farm record.",
        "review": "An agriculture officer needs to review this request. Wait for their guidance before changing irrigation.",
        "missing_prefix": "AquaProof needs updated information before it can advise.",
        "missing": {"crop": "Confirm crop and planting date.", "measurements": "Ask the officer to record current soil-water measurements.",
                    "supply": "Confirm canal or pump availability and measured flow.", "weather": "Reliable current forecasts are unavailable.",
                    "season": "Confirm that the crop is still in season."},
        "no_water": "Today's model does not recommend additional irrigation. Check actual soil moisture before changing your schedule.",
        "units": ("canal water", "tubewell water", "pump time", "estimated pump cost"),
        "turn": "Use canal water only during your registered Warabandi turn.",
        "weather": "Forecast for {day}: rain {rain} mm, rain chance {rain_chance}%, high {high}°C, humidity {humidity}%.",
        "history": "The field has {count} recently available verified irrigation or condition reports. Ask an officer for details.",
        "tips": {"check_soil":"Check the root-zone soil before irrigating.", "check_water_supply":"Confirm local water is available.",
                 "inspect_drainage":"Check whether field drains are clear."},
    },
    "ur": {
        "verify": "ایکو پروف کی تصدیق کے لیے نیچے دی گئی تصدیقی سطر کے ساتھ جواب دیں۔ اس سے آپ کا ای میل اور کھیت کی معلومات لینے کی رضا مندی تصدیق ہو گی۔",
        "verified": "آپ کا ایکو پروف ای میل تصدیق ہو گیا ہے۔ کھیت سے متعلق سوال یا رپورٹ کے ساتھ نئی تصدیقی سطر بھیجیں۔",
        "clarify": "براہ کرم کھیت کا نام اور اپنا سوال بتائیں۔ اس پیغام کی تصدیقی سطر بھی ساتھ لکھیں۔",
        "observation": "آپ کی رپورٹ مل گئی ہے۔ ریکارڈ میں شامل کرنے سے پہلے افسر تصدیق کرے گا۔",
        "review": "زرعی افسر اس معاملے کا جائزہ لے گا۔ آبپاشی تبدیل کرنے سے پہلے ان کی ہدایت کا انتظار کریں۔",
        "missing_prefix": "آبپاشی کے مشورے کے لیے تازہ معلومات درکار ہیں۔",
        "missing": {"crop":"فصل اور بوائی کی تاریخ بتائیں۔", "measurements":"افسر سے مٹی میں موجود پانی کی تازہ پیمائش درج کروائیں۔",
                    "supply":"نہری یا ٹیوب ویل کے پانی اور بہاؤ کی تصدیق کریں۔", "weather":"تازہ قابل اعتماد موسم دستیاب نہیں۔",
                    "season":"تصدیق کریں کہ فصل ابھی موسم میں ہے۔"},
        "no_water": "آج کے حساب کے مطابق اضافی آبپاشی درکار نہیں ہے۔ شیڈول بدلنے سے پہلے مٹی کی نمی دیکھیں۔",
        "units": ("نہری پانی", "ٹیوب ویل کا پانی", "پمپ چلانے کا وقت", "پمپ کا اندازاً خرچ"),
        "turn": "نہری پانی صرف درج شدہ وارہ بندی کی باری میں استعمال کریں۔",
        "weather": "{day} کا موسم: بارش {rain} ملی میٹر، امکان {rain_chance}%، زیادہ سے زیادہ حرارت {high}°C، نمی {humidity}%۔",
        "history": "کھیت کے {count} تازہ تصدیق شدہ ریکارڈ دستیاب ہیں۔ تفصیل کے لیے افسر سے رابطہ کریں۔",
        "tips": {"check_soil":"پانی لگانے سے پہلے جڑوں کی مٹی دیکھیں۔", "check_water_supply":"پانی دستیاب ہونے کی تصدیق کریں۔",
                 "inspect_drainage":"پانی کی نکاسی کے راستے چیک کریں۔"},
    },
    "roman_ur": {
        "verify": "AquaProof ki tasdeeq ke liye neeche di hui tasdeeqi line ke sath jawab dein. Is se email aur kheti ke updates ke liye razamandi ki tasdeeq hogi.",
        "verified": "Aap ka AquaProof email tasdeeq ho gaya. Khet ka sawal ya report bhejte waqt nayi tasdeeqi line shamil karein.",
        "clarify": "Khet ka naam aur apna sawal batayein. Is paigham ki tasdeeqi line bhi sath likhein.",
        "observation": "Aap ki report mil gayi. Officer tasdeeq ke baad isay record mein shamil karega.",
        "review": "Zarai officer iska jaiza lega. Pani ka faisla badalne se pehle rehnumai ka intezar karein.",
        "missing_prefix": "Pani ka mashwara dene ke liye nayi maloomat chahiye.",
        "missing": {"crop":"Fasal aur buwai ki tareekh batayein.", "measurements":"Officer se mitti ke pani ki nayi paimaish darj karwayein.",
                    "supply":"Nehri ya tubewell ka pani aur bahaao tasdeeq karein.", "weather":"Bharosemand taza mausam dastiyab nahin.",
                    "season":"Tasdeeq karein ke fasal abhi season mein hai."},
        "no_water": "Aaj ke hisaab mein mazeed pani ki zaroorat nahin. Schedule badalne se pehle mitti ki nami dekhein.",
        "units": ("nehri pani", "tubewell ka pani", "pump ka waqt", "pump ka andazay ka kharch"),
        "turn": "Nehri pani sirf darj shuda warabandi ki bari mein lagayein.",
        "weather": "{day} ka mausam: barish {rain} mm, imkaan {rain_chance}%, zyada se zyada hararat {high}°C, nami {humidity}%.",
        "history": "Khet ke {count} taza tasdeeq shuda records mojood hain. Tafseel ke liye officer se rabta karein.",
        "tips": {"check_soil":"Pani lagane se pehle jarron ki mitti dekhein.", "check_water_supply":"Pani ki dastiyabi tasdeeq karein.",
                 "inspect_drainage":"Pani ke nikaas ke raste check karein."},
    },
}


def template(language, key):
    return COPY[language][key]


def report(language, farm_name, evidence, tip="none"):
    copy = COPY[language]
    name = clean(farm_name).replace("\n", " ").strip()
    if evidence.get("missing"):
        content = " ".join(copy["missing"][key] for key in evidence["missing"])
        return f"{name}\n{copy['missing_prefix']} {content}"
    today = evidence["today"]
    name = f"{name} · {evidence['plan']['crop']} · {today['stage']}"
    data = evidence["forecast"]["daily"][0]
    forecast = weather_report(language, data)
    if not today["canal_m3"] and not today["pump_m3"]:
        precaution = copy["tips"].get(tip)
        return f"{name}\n{copy['no_water']}\n{forecast}" + (f"\n{precaution}" if precaution else "")
    canal, pump, runtime, cost = copy["units"]
    pieces = [name, forecast]
    if today["canal_m3"]:
        pieces.append(f"{canal}: {today['canal_m3']:g} m³ · {evidence['canal_use_hours']:g} h. {copy['turn']}")
    if today["pump_m3"] and evidence["pump"]:
        pieces.append(f"{pump}: {today['pump_m3']:g} m³ · {runtime}: {evidence['pump']['hours']:g} h · "
                      f"{cost}: PKR {evidence['pump']['pkr']:g}")
    if tip in copy["tips"]:
        pieces.append(copy["tips"][tip])
    return "\n".join(pieces)


def weather_report(language, row):
    def show(key):
        return row[key] if row.get(key) is not None else "—"
    return COPY[language]["weather"].format(
        day=row["date"], rain=show("rain_mm"), rain_chance=show("precip_probability_pct"),
        high=show("max_c"), humidity=show("humidity_pct"),
    )
