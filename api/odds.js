function normTeam(t){
  const m={LAR:"LA",WSH:"WAS",OAK:"LV",JAC:"JAX"};
  t=String(t||"").toUpperCase();
  return m[t]||t;
}
function teamAbbr(side){
  const t=side||{};
  return normTeam(t.abbreviation||t.names?.short||t.name||t.teamID||"");
}
function americanToProb(v){
  if(v===null||v===undefined)return null;
  const o=Number(String(v).replace("+",""));
  if(!Number.isFinite(o)||o===0)return null;
  return o<0 ? (-o)/((-o)+100) : 100/(o+100);
}
function median(arr){
  const a=arr.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}

const MAJOR=["draftkings","fanduel","betmgm","caesars","espnbet","bet365"];
function medianRawOdds(vals){
  const nums=vals.map(v=>Number(String(v).replace("+",""))).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!nums.length)return null;
  const m=Math.floor(nums.length/2);
  return nums.length%2?nums[m]:Math.round((nums[m-1]+nums[m])/2);
}


function pairedBookProbabilities(homeOdd,awayOdd){
  const hb=homeOdd?.byBookmaker||{};
  const ab=awayOdd?.byBookmaker||{};
  const rows=[];

  for(const book of MAJOR){
    const hRec=hb[book], aRec=ab[book];
    if(!hRec||!aRec||hRec.available===false||aRec.available===false) continue;

    const hRaw=americanToProb(hRec.odds);
    const aRaw=americanToProb(aRec.odds);
    if(hRaw==null||aRaw==null) continue;

    const sum=hRaw+aRaw;
    // Normal two-way moneyline vig sanity range.
    if(sum<0.98||sum>1.20) continue;

    rows.push({
      book,
      homeProb:hRaw/sum,
      awayProb:aRaw/sum,
      homeOdds:hRec.odds,
      awayOdds:aRec.odds
    });
  }

  return rows;
}

export default async function handler(req,res){
  const apiKey=process.env.SPORTSGAMEODDS_API_KEY;
  if(!apiKey){
    return res.status(503).json({error:"SPORTSGAMEODDS_API_KEY is not configured."});
  }

  try{
    const url=new URL("https://api.sportsgameodds.com/v2/events");
    url.searchParams.set("leagueID","NFL");
    url.searchParams.set("oddsAvailable","true");
    url.searchParams.set("limit","100");
    url.searchParams.set("oddID","points-home-game-ml-home,points-away-game-ml-away");
    url.searchParams.set("startsAfter","2026-09-01T00:00:00.000Z");
    url.searchParams.set("startsBefore","2027-01-06T23:59:59.000Z");

    const r=await fetch(url,{headers:{"x-api-key":apiKey}});
    if(!r.ok){
      return res.status(r.status).send(await r.text());
    }

    const obj=await r.json();
    const events=obj.data||obj.events||[];
    const games=[];

    for(const ev of events){
      const home=teamAbbr(ev.teams?.home);
      const away=teamAbbr(ev.teams?.away);
      if(!home||!away) continue;

      const ho=ev.odds?.["points-home-game-ml-home"];
      const ao=ev.odds?.["points-away-game-ml-away"];

      if(!ho||!ao){
        games.push({home,away,valid:false,warning:"missing exact home/away moneyline market"});
        continue;
      }

      let homeProb=null,awayProb=null,method="",bookDetail="";
      const paired=pairedBookProbabilities(ho,ao);
      const medianHomeRaw=medianRawOdds(paired.map(x=>x.homeOdds));
      const medianAwayRaw=medianRawOdds(paired.map(x=>x.awayOdds));


      // PRIMARY: median no-vig probabilities from paired major books.
      if(paired.length>=2){
        homeProb=median(paired.map(x=>x.homeProb));
        awayProb=median(paired.map(x=>x.awayProb));

        // Renormalize tiny median mismatch.
        const s=homeProb+awayProb;
        homeProb/=s; awayProb/=s;

        method=`median no-vig major books (${paired.length})`;
        bookDetail=paired.slice(0,4).map(x =>
          `${x.book}:${away} ${x.awayOdds}/${home} ${x.homeOdds}`
        ).join(" | ");
      } else {
        // FALLBACK: SportsGameOdds fairOdds pair.
        const hf=americanToProb(ho.fairOdds);
        const af=americanToProb(ao.fairOdds);
        if(hf!=null&&af!=null){
          const s=hf+af;
          if(s>=0.97&&s<=1.03){
            homeProb=hf/s; awayProb=af/s;
            method="fallback fairOdds";
          }
        }
      }

      let valid=Number.isFinite(homeProb)&&Number.isFinite(awayProb);
      let warning="";

      if(valid){
        const sum=homeProb+awayProb;
        if(Math.abs(sum-1)>0.005){
          valid=false;
          warning=`probabilities do not sum to 1: ${sum}`;
        }
        if(homeProb<=0||homeProb>=1||awayProb<=0||awayProb>=1){
          valid=false;
          warning="invalid probability range";
        }
      } else {
        warning="no usable paired major-book or fairOdds market";
      }

      games.push({
        eventID:ev.eventID,
        startTime:ev.startTime,
        home,away,valid,warning,method,bookDetail,
        homeProb:valid?homeProb:null,
        awayProb:valid?awayProb:null,
        medianHomeRaw,
        medianAwayRaw,
        homeFairOdds:ho?.fairOdds||null,
        awayFairOdds:ao?.fairOdds||null
      });
    }

    res.setHeader("Cache-Control","s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({games,updatedAt:new Date().toISOString()});

  }catch(err){
    return res.status(500).json({
      error:"Failed to fetch/normalize Survivor moneylines",
      detail:String(err)
    });
  }
}