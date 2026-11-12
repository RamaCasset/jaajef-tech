/**
 * The four legal texts (privacy, terms, community rules, job rules), in French and English.
 * DRAFT: written to match what the app really does today. A lawyer must review them before launch,
 * and every [TO CONFIRM] / [À CONFIRMER] marker must be filled in. See docs/POLICIES_TO_CONFIRM.md.
 */
export type LegalDocKey = 'privacy' | 'terms' | 'rules' | 'jobs'
export type LegalDoc = { title: string; intro: string; sections: { h: string; p: string[] }[] }
export type LegalSet = {
  draft: string
  updated: string
  back: string
  menu: string
  docs: Record<LegalDocKey, LegalDoc>
}

const fr: LegalSet = {
  draft: "Version provisoire : ce texte sera relu par un juriste avant le lancement. Les passages [À CONFIRMER] seront complétés.",
  updated: 'Dernière mise à jour : 11 novembre 2026',
  back: 'Retour',
  menu: 'Textes et règles',
  docs: {
    privacy: {
      title: 'Politique de confidentialité',
      intro: "jaajef.tech respecte votre vie privée. Cette page explique, simplement, quelles informations nous gardons, pourquoi, qui peut les voir et comment vous gardez le contrôle.",
      sections: [
        { h: 'Qui sommes-nous ?', p: [
          "jaajef.tech est une plateforme pour les développeurs, designers et passionnés de technologie, au Sénégal et dans la diaspora. Elle est éditée par [À CONFIRMER : nom de la structure, adresse].",
          "Pour toute question sur vos données : ramatoulaye@jaramatech.com.",
        ] },
        { h: 'Ce que nous recueillons', p: [
          "Votre compte : adresse e-mail et mot de passe. Le mot de passe n'est jamais gardé en clair. Si vous vous connectez avec GitHub, nous recevons votre identifiant et votre adresse e-mail GitHub.",
          "Votre profil : nom affiché, nom d'utilisateur, présentation, ville, région, clan, liens, photo ou cadre choisi. Ce que vous remplissez est votre choix.",
          "Ce que vous écrivez ou publiez : messages, questions et réponses, articles, projets et fichiers de code, commentaires.",
          "Vos candidatures : le message, votre dossier de candidature (profil, projets, CV que vous joignez) tel qu'il était le jour de l'envoi.",
          "Vos achats : les paiements de Kopeks passent par notre prestataire de paiement. Nous ne voyons ni ne gardons votre numéro de carte ou de compte mobile. Nous gardons le montant, la date et l'état du paiement.",
          "Des données techniques minimales : pour que le site fonctionne et reste sûr (connexion, sécurité, journaux d'erreurs).",
        ] },
        { h: 'Pourquoi nous les utilisons', p: [
          "Pour faire fonctionner le service : vous connecter, afficher votre profil, vous permettre d'échanger, de publier, de postuler, d'acheter.",
          "Pour vous envoyer des notifications et des e-mails que vous avez choisis (vous réglez leur rythme dans vos paramètres).",
          "Pour protéger la communauté : traiter les signalements, lutter contre le spam et les fraudes.",
          "Nous ne vendons pas vos données et nous n'affichons pas de publicité ciblée.",
        ] },
        { h: 'Qui peut voir quoi', p: [
          "Public pour les membres connectés : votre profil, vos projets, vos articles et vos messages dans les espaces ouverts.",
          "Privé : votre adresse e-mail, vos messages privés et vos paramètres. Les conversations privées ne sont lues que par les personnes concernées.",
          "Candidatures : seule la personne qui a publié l'offre voit votre dossier de candidature, tant que la candidature reste ouverte. Après un refus ou la fermeture de l'offre, l'accès est limité dans le temps puis fermé.",
          "L'équipe : les modérateurs ne voient que ce qui est signalé, pour traiter le signalement. Les administrateurs gèrent les rôles de l'équipe.",
        ] },
        { h: 'Connexion avec Google et GitHub', p: [
          "Si vous choisissez « Se connecter avec Google », Google nous transmet votre nom, votre adresse e-mail et votre photo de profil. Nous ne demandons aucune autre permission : pas vos contacts, pas votre agenda, pas vos fichiers, pas votre Gmail.",
          "Nous utilisons ces trois informations uniquement pour créer et afficher votre compte. Nous ne les vendons pas, ne les utilisons pas pour de la publicité et ne les partageons avec personne d'autre, sauf obligation légale. Notre utilisation des informations reçues de Google respecte la politique des services API de Google (User Data Policy), y compris les exigences d'utilisation limitée. Elles sont transmises par connexion chiffrée (HTTPS) et protégées par des règles d'accès dans notre base de données : seul vous et le personnel autorisé de jaajef.tech pouvez y accéder.",
          "Nous utilisons ces trois informations uniquement pour créer votre compte, vous reconnaître quand vous revenez et afficher votre nom et votre photo dans jaajef.tech. Nous ne les vendons pas, ne les utilisons pas pour de la publicité et ne les partageons avec personne d'autre que les services listés plus haut, qui font fonctionner le site.",
          "L'utilisation par jaajef.tech des informations reçues de Google respecte la politique de Google sur les données des utilisateurs des services API, y compris ses exigences d'utilisation limitée. Ces informations ne servent pas à entraîner des modèles d'intelligence artificielle.",
          "Vous pouvez retirer l'accès de jaajef.tech à votre compte Google à tout moment dans les paramètres de sécurité de votre compte Google, et supprimer votre compte jaajef.tech dans vos paramètres : vos données reçues de Google sont alors supprimées avec lui.",
          "Avec GitHub, c'est pareil : nous recevons votre identifiant GitHub, votre adresse e-mail et votre photo. Si vous importez un projet, nous lisons seulement vos dépôts publics.",
        ] },
        { h: 'Les services qui nous aident', p: [
          "Pour fonctionner, nous nous appuyons sur : Supabase (base de données, connexion, stockage des fichiers), Vercel (hébergement du site), E2B (exécution isolée du code des quêtes : le code que vous envoyez y est exécuté puis effacé), PayDunya (paiements), GitHub (connexion et lecture de vos dépôts publics si vous les importez) et [À CONFIRMER : service d'envoi d'e-mails].",
          "Certains de ces services sont situés hors du Sénégal. Nous ne leur confions que ce qui est nécessaire à leur mission.",
        ] },
        { h: 'Combien de temps nous gardons vos données', p: [
          "Tant que votre compte existe. Vous pouvez demander la suppression de votre compte dans vos paramètres : vous avez 14 jours pour changer d'avis, puis votre compte, votre profil, vos messages, vos projets et vos fichiers sont supprimés. Seule une trace anonyme prouve que la suppression a eu lieu.",
          "Vous pouvez aussi télécharger une copie de vos données à tout moment.",
          "Les journaux techniques sont gardés [À CONFIRMER : durée] puis effacés.",
        ] },
        { h: 'Vos droits', p: [
          "Vous pouvez consulter, corriger, télécharger et supprimer vos données, vous opposer à certains usages et retirer votre accord. La plupart de ces actions se font seul, dans vos paramètres. Sinon, écrivez-nous.",
          "Au Sénégal, la protection des données personnelles est encadrée par la loi n° 2008-12 et surveillée par la Commission de protection des données personnelles (CDP), auprès de laquelle vous pouvez aussi déposer une plainte. [À CONFIRMER : déclaration à la CDP.]",
        ] },
        { h: 'Sécurité', p: [
          "Les accès sont protégés par des règles côté serveur : chaque membre ne peut lire que ce qu'il a le droit de voir. Les fichiers privés sont dans un stockage fermé. Aucun système n'est parfait : si un incident touche vos données, nous vous le dirons.",
        ] },
        { h: 'Cookies et stockage dans le navigateur', p: [
          "Nous utilisons uniquement ce qui est nécessaire : garder votre connexion, votre langue et votre thème de couleurs. Pas de cookies publicitaires ni de suivi par des tiers.",
        ] },
        { h: 'Les jeunes', p: [
          "jaajef.tech est réservé aux personnes de [À CONFIRMER : 16] ans et plus. En dessous, l'accord d'un parent ou tuteur est nécessaire.",
        ] },
        { h: 'Changements', p: [
          "Si ce texte change de façon importante, nous vous le dirons dans l'application avant qu'il s'applique.",
        ] },
      ],
    },
    terms: {
      title: "Conditions d'utilisation",
      intro: "En créant un compte sur jaajef.tech, vous acceptez ces règles du jeu. Elles sont courtes : lisez-les.",
      sections: [
        { h: 'Votre compte', p: [
          "Un compte, une personne. Gardez votre mot de passe pour vous. Ce qui se passe depuis votre compte est de votre responsabilité.",
          "Donnez des informations vraies. Ne vous faites pas passer pour quelqu'un d'autre.",
        ] },
        { h: 'Ce que vous publiez', p: [
          "Vous restez propriétaire de ce que vous créez. En le publiant ici, vous nous autorisez à l'afficher aux personnes à qui vous le destinez, pour faire fonctionner la plateforme.",
          "Ne publiez que ce que vous avez le droit de publier. Ne présentez jamais le travail d'une autre personne comme le vôtre : si un projet n'est pas le vôtre, dites-le et citez son auteur.",
          "Les licences des projets restent celles que leurs auteurs ont choisies.",
        ] },
        { h: 'Bien se comporter', p: [
          "Les règles de la communauté font partie de ces conditions. Les manquements graves peuvent entraîner le retrait d'un contenu, un avertissement, une suspension ou la fermeture du compte.",
        ] },
        { h: "Le code et l'exécuteur de quêtes", p: [
          "Le code des quêtes s'exécute dans un espace isolé, avec des limites de temps et de mémoire. N'essayez pas d'en sortir, de l'attaquer ou de l'utiliser pour autre chose qu'apprendre.",
        ] },
        { h: 'Kopeks, Souk et paiements', p: [
          "Les Kopeks sont des points virtuels du jeu. Ils n'ont pas de valeur en argent et ne sont pas remboursables en espèces, sauf disposition légale contraire. [À CONFIRMER : politique de remboursement.]",
          "Les Kopeks achetés sont payés par notre prestataire de paiement. Les objets du Souk servent à personnaliser votre expérience.",
        ] },
        { h: "Offres d'emploi et missions", p: [
          "jaajef.tech met en relation. Nous ne sommes ni l'employeur ni un intermédiaire du contrat. Nous ne garantissons ni une offre, ni un recrutement, ni l'honnêteté de celui qui publie.",
          "Les règles pour publier et candidater sont dans la page « Règles des offres ».",
        ] },
        { h: 'Notre responsabilité', p: [
          "Nous faisons de notre mieux pour que le service soit disponible et sûr, mais il est fourni tel quel. Nous ne sommes pas responsables des contenus publiés par les membres ni des échanges entre membres, dans la mesure permise par la loi.",
        ] },
        { h: 'Fin du compte', p: [
          "Vous pouvez supprimer votre compte quand vous voulez. Nous pouvons suspendre ou fermer un compte qui ne respecte pas ces règles.",
        ] },
        { h: 'Droit applicable', p: [
          "Ces conditions sont régies par le droit sénégalais. [À CONFIRMER : tribunal compétent.]",
        ] },
        { h: 'Changements et contact', p: [
          "Nous pouvons modifier ces conditions. Les changements importants vous seront annoncés avant leur entrée en vigueur. Contact : ramatoulaye@jaramatech.com.",
        ] },
      ],
    },
    rules: {
      title: 'Règles de la communauté',
      intro: "La Cité est un lieu d'entraide. Ces règles servent à ce que chacun s'y sente bien et en sécurité.",
      sections: [
        { h: 'Respect', p: [
          "Pas d'insultes, de harcèlement, de menaces, ni de propos haineux (origine, ethnie, religion, genre, orientation, handicap, âge). On critique le code, pas la personne.",
        ] },
        { h: 'Entraide honnête', p: [
          "Posez vos questions sans honte. Répondez avec bienveillance. Dites quand vous ne savez pas.",
          "Indiquez vos sources quand vous reprenez le travail d'un autre.",
        ] },
        { h: 'Pas de spam ni de fraude', p: [
          "Pas de publicité répétée, de liens trompeurs, d'arnaques, de faux comptes ni de manipulation des étoiles, des votes ou des scores.",
        ] },
        { h: 'Sécurité', p: [
          "Ne publiez jamais de mots de passe, de clés d'accès ou de données personnelles d'autrui. Pas de logiciel malveillant ni de code fait pour nuire.",
          "Si vous trouvez une faille, signalez-la à l'équipe plutôt que de l'exploiter.",
        ] },
        { h: 'Contenu interdit', p: [
          "Contenus sexuels ou violents choquants, contenus qui exploitent des enfants, apologie de la violence, contenus illégaux. Ils sont retirés tout de suite.",
        ] },
        { h: 'Signaler', p: [
          "Un contenu ou un membre vous pose problème ? Utilisez le bouton de signalement. L'équipe regarde chaque signalement.",
        ] },
        { h: 'Ce qui peut arriver', p: [
          "Selon la gravité : retrait du contenu, avertissement, suspension pour une durée donnée, puis fermeture du compte en cas de récidive ou de faute grave. Vous êtes prévenu de la décision.",
        ] },
      ],
    },
    jobs: {
      title: 'Règles des offres',
      intro: "Les offres et missions mettent en relation des personnes. Ces règles protègent ceux qui publient comme ceux qui postulent.",
      sections: [
        { h: 'Pour publier une offre', p: [
          "L'offre doit être réelle : un vrai poste ou une vraie mission, décrite honnêtement (rôle, lieu, mode de travail, rémunération ou « à négocier »).",
          "Il est interdit de demander de l'argent aux candidats (frais de dossier, formation payante, caution) et de promettre des gains irréalistes.",
          "Pas de discrimination : ne refusez pas une personne à cause de son origine, son genre, sa religion, son âge ou son handicap.",
          "Fermez l'offre quand le poste est pourvu. Nous vous rappelons les offres ouvertes depuis trois mois.",
        ] },
        { h: 'Les candidatures que vous recevez', p: [
          "Les dossiers de candidature sont des données personnelles. Utilisez-les seulement pour le recrutement concerné, ne les partagez pas et ne les gardez pas plus longtemps que nécessaire.",
          "Répondez avec respect, même pour un refus. Le candidat voit l'état de sa candidature.",
        ] },
        { h: 'Pour postuler', p: [
          "Soyez honnête sur votre parcours, vos compétences et vos projets.",
          "En postulant, vous acceptez que la personne qui a publié l'offre voie votre dossier de candidature (profil, message et CV joint). Vous pouvez retirer votre candidature.",
          "Méfiez-vous d'une offre qui demande de l'argent, des codes ou des informations bancaires. Signalez-la.",
        ] },
        { h: 'Signalement et retrait', p: [
          "Une offre trompeuse ou abusive peut être signalée. L'équipe peut la retirer et suspendre son auteur.",
          "jaajef.tech n'est pas partie au contrat entre le candidat et celui qui recrute.",
        ] },
      ],
    },
  },
}

const en: LegalSet = {
  draft: "Provisional version: a lawyer will review this text before launch. Passages marked [TO CONFIRM] will be completed.",
  updated: 'Last updated: 11 November 2026',
  back: 'Back',
  menu: 'Policies and rules',
  docs: {
    privacy: {
      title: 'Privacy policy',
      intro: 'jaajef.tech respects your privacy. This page explains, simply, what information we keep, why, who can see it and how you stay in control.',
      sections: [
        { h: 'Who we are', p: [
          'jaajef.tech is a platform for developers, designers and tech enthusiasts in Senegal and the diaspora. It is run by [TO CONFIRM: name of the organisation, address].',
          'For any question about your data: ramatoulaye@jaramatech.com.',
        ] },
        { h: 'What we collect', p: [
          'Your account: e-mail address and password. The password is never kept in plain text. If you sign in with GitHub, we receive your GitHub identifier and e-mail address.',
          'Your profile: display name, username, bio, city, region, clan, links, chosen picture or frame. What you fill in is your choice.',
          'What you write or publish: messages, questions and answers, articles, projects and code files, comments.',
          'Your applications: your message and your application file (profile, projects, any CV you attach) as it was the day you sent it.',
          'Your purchases: Kopek payments go through our payment provider. We never see or keep your card or mobile money number. We keep the amount, date and status of the payment.',
          'Minimal technical data: to keep the site working and safe (sign-in, security, error logs).',
        ] },
        { h: 'Why we use it', p: [
          'To run the service: sign you in, show your profile, let you chat, publish, apply and buy.',
          'To send the notifications and e-mails you chose (you set their pace in your settings).',
          'To protect the community: handle reports, fight spam and fraud.',
          'We do not sell your data and we show no targeted advertising.',
        ] },
        { h: 'Who can see what', p: [
          'Visible to signed-in members: your profile, projects, articles and messages in open spaces.',
          'Private: your e-mail address, private messages and settings. Private conversations are read only by the people in them.',
          'Applications: only the person who posted the offer sees your application file, while the application is open. After a decline or when the offer closes, access is limited in time and then closed.',
          'The team: moderators see only what is reported, to handle the report. Administrators manage team roles.',
        ] },
        { h: 'Signing in with Google and GitHub', p: [
          "If you choose \"Sign in with Google\", Google sends us your name, e-mail address and profile picture. We ask for no other permission: not your contacts, calendar, files or Gmail.",
          'We use these three pieces of information only to create and show your account. We do not sell them, do not use them for advertising and do not share them with anyone else, except where the law requires it. Our use of information received from Google follows the Google API Services User Data Policy, including its Limited Use requirements. It travels over an encrypted connection (HTTPS) and is protected by access rules in our database: only you and authorised jaajef.tech staff can reach it.',
          "We use these three pieces of information only to create your account, recognise you when you come back and show your name and picture inside jaajef.tech. We do not sell them, do not use them for advertising and do not share them with anyone other than the services listed above, which make the site work.",
          "jaajef.tech's use of information received from Google follows the Google API Services User Data Policy, including its Limited Use requirements. This information is not used to train artificial intelligence models.",
          "You can remove jaajef.tech's access to your Google account at any time in your Google account security settings, and delete your jaajef.tech account in your settings: the data we received from Google is then deleted with it.",
          "GitHub works the same way: we receive your GitHub identifier, e-mail address and picture. If you import a project, we only read your public repositories.",
        ] },
        { h: 'Services that help us', p: [
          'To run, we rely on: Supabase (database, sign-in, file storage), Vercel (site hosting), E2B (isolated running of quest code: the code you send is run there and then erased), PayDunya (payments), GitHub (sign-in and reading your public repositories if you import them) and [TO CONFIRM: e-mail sending service].',
          'Some of these services are located outside Senegal. We only give them what they need to do their job.',
        ] },
        { h: 'How long we keep your data', p: [
          'As long as your account exists. You can ask to delete your account in your settings: you have 14 days to change your mind, then your account, profile, messages, projects and files are deleted. Only an anonymous trace proves the deletion happened.',
          'You can also download a copy of your data at any time.',
          'Technical logs are kept for [TO CONFIRM: duration] and then erased.',
        ] },
        { h: 'Your rights', p: [
          'You can view, correct, download and delete your data, object to some uses and withdraw your consent. Most of this you can do yourself in your settings. Otherwise, write to us.',
          'In Senegal, personal data protection is governed by law no. 2008-12 and overseen by the Commission de protection des données personnelles (CDP), where you can also file a complaint. [TO CONFIRM: CDP declaration.]',
        ] },
        { h: 'Security', p: [
          'Access is protected by rules on the server: each member can only read what they are allowed to see. Private files are in a closed storage. No system is perfect: if an incident affects your data, we will tell you.',
        ] },
        { h: 'Cookies and browser storage', p: [
          'We only use what is necessary: keeping you signed in, your language and your colour theme. No advertising cookies and no third-party tracking.',
        ] },
        { h: 'Young people', p: [
          'jaajef.tech is for people aged [TO CONFIRM: 16] and over. Below that, a parent or guardian must agree.',
        ] },
        { h: 'Changes', p: [
          'If this text changes in an important way, we will tell you in the app before it applies.',
        ] },
      ],
    },
    terms: {
      title: 'Terms of use',
      intro: 'By creating an account on jaajef.tech, you accept these rules of the game. They are short: please read them.',
      sections: [
        { h: 'Your account', p: [
          'One account, one person. Keep your password to yourself. What happens from your account is your responsibility.',
          'Give true information. Do not pretend to be someone else.',
        ] },
        { h: 'What you publish', p: [
          'You remain the owner of what you create. By publishing it here, you allow us to show it to the people you meant it for, so the platform can work.',
          'Only publish what you have the right to publish. Never present someone else\'s work as yours: if a project is not yours, say so and credit its author.',
          'Project licences stay as their authors chose them.',
        ] },
        { h: 'Behaving well', p: [
          'The community rules are part of these terms. Serious breaches can lead to content removal, a warning, a suspension or closure of the account.',
        ] },
        { h: 'Code and the quest runner', p: [
          'Quest code runs in an isolated space, with time and memory limits. Do not try to escape it, attack it or use it for anything other than learning.',
        ] },
        { h: 'Kopeks, the Souk and payments', p: [
          'Kopeks are virtual points in the game. They have no cash value and cannot be refunded in cash, unless the law says otherwise. [TO CONFIRM: refund policy.]',
          'Purchased Kopeks are paid through our payment provider. Souk items personalise your experience.',
        ] },
        { h: 'Job offers and missions', p: [
          'jaajef.tech connects people. We are not the employer nor an intermediary to the contract. We do not guarantee any offer, any hire, or the honesty of whoever posts.',
          'The rules for posting and applying are on the "Job rules" page.',
        ] },
        { h: 'Our responsibility', p: [
          'We do our best to keep the service available and safe, but it is provided as is. We are not responsible for content posted by members or for exchanges between members, as far as the law allows.',
        ] },
        { h: 'Ending an account', p: [
          'You can delete your account whenever you want. We may suspend or close an account that does not follow these rules.',
        ] },
        { h: 'Applicable law', p: [
          'These terms are governed by Senegalese law. [TO CONFIRM: competent court.]',
        ] },
        { h: 'Changes and contact', p: [
          'We may change these terms. Important changes will be announced before they apply. Contact: ramatoulaye@jaramatech.com.',
        ] },
      ],
    },
    rules: {
      title: 'Community rules',
      intro: 'The City is a place for helping each other. These rules are here so everyone feels welcome and safe.',
      sections: [
        { h: 'Respect', p: [
          'No insults, harassment, threats or hateful speech (origin, ethnicity, religion, gender, orientation, disability, age). Criticise the code, not the person.',
        ] },
        { h: 'Honest help', p: [
          'Ask your questions without shame. Answer kindly. Say when you do not know.',
          'Give your sources when you build on someone else\'s work.',
        ] },
        { h: 'No spam, no fraud', p: [
          'No repeated advertising, misleading links, scams, fake accounts, or manipulation of stars, votes or scores.',
        ] },
        { h: 'Security', p: [
          'Never post passwords, access keys or other people\'s personal data. No malware or code made to harm.',
          'If you find a weakness, report it to the team instead of exploiting it.',
        ] },
        { h: 'Forbidden content', p: [
          'Shocking sexual or violent content, content that exploits children, glorifying violence, illegal content. These are removed at once.',
        ] },
        { h: 'Reporting', p: [
          'A content or a member is a problem for you? Use the report button. The team looks at every report.',
        ] },
        { h: 'What can happen', p: [
          'Depending on how serious it is: content removal, a warning, a suspension for a set time, then closure of the account for repeat or serious breaches. You are told about the decision.',
        ] },
      ],
    },
    jobs: {
      title: 'Job rules',
      intro: 'Offers and missions connect people. These rules protect those who post and those who apply.',
      sections: [
        { h: 'To post an offer', p: [
          'The offer must be real: a real job or mission, described honestly (role, place, way of working, pay or "negotiable").',
          'Asking candidates for money (application fees, paid training, deposits) and promising unrealistic earnings are forbidden.',
          'No discrimination: do not turn someone down because of origin, gender, religion, age or disability.',
          'Close the offer when the position is filled. We remind you about offers open for three months.',
        ] },
        { h: 'Applications you receive', p: [
          'Application files are personal data. Use them only for the hiring concerned, do not share them and do not keep them longer than needed.',
          'Reply with respect, even to say no. The candidate sees the status of their application.',
        ] },
        { h: 'To apply', p: [
          'Be honest about your background, skills and projects.',
          'By applying, you accept that the person who posted the offer sees your application file (profile, message and attached CV). You can withdraw your application.',
          'Be careful with an offer that asks for money, codes or bank details. Report it.',
        ] },
        { h: 'Reporting and removal', p: [
          'A misleading or abusive offer can be reported. The team can remove it and suspend its author.',
          'jaajef.tech is not a party to the contract between the candidate and the person hiring.',
        ] },
      ],
    },
  },
}

export const legal = { fr, en }
