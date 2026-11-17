"""Skills Prepify recognises in job descriptions, resumes and search queries.

Each skill has a regex (written so it works unchanged in Python and in the browser's JavaScript,
always used case-insensitively), what to revise for it, and well-known interview questions on it.
The questions are general preparation material, never presented as "asked at company X".
"""
import re

SKILLS = []


def S(name, category, pattern, topics=(), questions=()):
    SKILLS.append({'name': name, 'category': category, 'pattern': pattern,
                   'topics': list(topics), 'questions': list(questions)})


# ---------- Languages ----------
S('Java', 'Languages', r'\bjava\b(?!\s*script)',
  ['OOP in Java', 'Collections framework', 'Exceptions', 'Multithreading and concurrency',
   'JVM memory and garbage collection', 'Streams and lambdas (Java 8+)'],
  ['How does HashMap work internally?', 'What is the difference between == and equals()?',
   'Abstract class vs interface: when would you use each?', 'How does garbage collection work in the JVM?'])
S('Python', 'Languages', r'\bpython\b',
  ['Data types and mutability', 'Comprehensions', 'Generators and iterators', 'Decorators',
   'The GIL and concurrency', 'OOP in Python'],
  ['What is the difference between a list and a tuple?', 'What are decorators and how do they work?',
   'What is the GIL and how does it affect multithreading?', 'Explain shallow copy vs deep copy.'])
S('JavaScript', 'Languages', r'\b(javascript|ecmascript|es6|vanilla js)\b',
  ['Closures and scope', 'The event loop', 'Promises and async/await', 'this and prototypes',
   'ES6+ features', 'DOM and events'],
  ['What is a closure? Give an example.', 'Explain the JavaScript event loop.',
   'What is the difference between var, let and const?', 'How do promises differ from async/await?'])
S('TypeScript', 'Languages', r'\btypescript\b',
  ['Types vs interfaces', 'Generics', 'Union types and narrowing', 'Utility types'],
  ['What is the difference between type and interface?', 'What are generics and when would you use them?',
   'How does type narrowing work?'])
S('C++', 'Languages', r'(?<![a-z0-9])(c\+\+|cpp)(?![a-z0-9+])',
  ['Pointers and references', 'Memory management', 'Virtual functions and polymorphism', 'STL containers',
   'RAII and smart pointers'],
  ['What is the difference between a pointer and a reference?', 'How do virtual functions and the vtable work?',
   'What are smart pointers and why use them?'])
S('C', 'Languages', r'\b(c programming|c language|ansi c|embedded c)\b|(?<![a-z0-9])c\s*/\s*c\+\+',
  ['Pointers and arrays', 'Memory allocation (malloc/free)', 'Structures and unions', 'Storage classes'],
  ['What is a dangling pointer?', 'What is the difference between malloc and calloc?',
   'What does the static keyword do in C?'])
S('C#', 'Languages', r'(?<![a-z0-9])c#|\bc sharp\b',
  ['The .NET runtime', 'LINQ', 'async/await', 'Value vs reference types'],
  ['What is the difference between a struct and a class in C#?', 'How does async/await work in C#?',
   'What is LINQ and when would you use it?'])
S('Go', 'Languages', r'\bgolang\b|\bgo\s*\(golang\)',
  ['Goroutines and channels', 'Interfaces', 'Error handling', 'Concurrency patterns'],
  ['How do goroutines differ from OS threads?', 'Buffered vs unbuffered channels?',
   'How does error handling work in Go?'])
S('Kotlin', 'Languages', r'\bkotlin\b',
  ['Null safety', 'Coroutines', 'Data classes', 'Extension functions'],
  ['How does Kotlin handle null safety?', 'What are coroutines?'])
S('Swift', 'Languages', r'\bswift\b(?!\s*code)',
  ['Optionals', 'Value vs reference types', 'Protocols', 'Memory management (ARC)'],
  ['What are optionals in Swift?', 'Struct vs class in Swift?'])
S('Rust', 'Languages', r'\brust\b',
  ['Ownership and borrowing', 'Lifetimes', 'Traits', 'Error handling with Result'],
  ['Explain ownership and borrowing in Rust.'])
S('Ruby', 'Languages', r'\bruby\b|\brails\b',
  ['Blocks, procs and lambdas', 'Rails MVC', 'ActiveRecord'],
  ['What is the difference between a proc and a lambda?'])
S('PHP', 'Languages', r'\bphp\b|\blaravel\b',
  ['PHP basics', 'Laravel MVC', 'Sessions and cookies'],
  ['What is the difference between include and require?'])
S('Scala', 'Languages', r'\bscala\b',
  ['Functional programming', 'Case classes', 'Pattern matching'],
  ['What are case classes used for?'])
S('Shell scripting', 'Languages', r'\b(shell scripting|bash|powershell)\b',
  ['Pipes and redirection', 'Variables and loops', 'grep, sed and awk'],
  ['How would you find the 10 largest files in a directory?'])

# ---------- Frontend ----------
S('React', 'Frontend', r'\breact(\.?js)?\b(?!\s*native)',
  ['Components and props', 'State and hooks', 'useEffect and the component lifecycle',
   'Reconciliation and the virtual DOM', 'Performance (memo, useMemo, useCallback)', 'State management'],
  ['What is the virtual DOM and how does reconciliation work?', 'Explain useEffect and its cleanup function.',
   'When would you use useMemo or useCallback?', 'Controlled vs uncontrolled components?'])
S('Angular', 'Frontend', r'\bangular(js)?\b',
  ['Components and modules', 'Dependency injection', 'RxJS observables', 'Change detection'],
  ['How does dependency injection work in Angular?', 'Observables vs promises?',
   'How does change detection work?'])
S('Vue', 'Frontend', r'\bvue(\.?js)?\b|\bnuxt\b',
  ['Reactivity system', 'Components and props', 'Composition API'],
  ['How does Vue\'s reactivity work?', 'Options API vs Composition API?'])
S('Next.js', 'Frontend', r'\bnext\.?js\b',
  ['SSR vs SSG vs ISR', 'Routing', 'Data fetching'],
  ['What is the difference between server-side rendering and static generation?'])
S('HTML & CSS', 'Frontend', r'\bhtml5?\b|\bcss3?\b|\bsass\b|\btailwind\b',
  ['Semantic HTML', 'The box model', 'Flexbox and grid', 'Specificity', 'Responsive design', 'Accessibility'],
  ['Explain the CSS box model.', 'Flexbox vs grid: when would you use each?', 'How does CSS specificity work?'])
S('Redux', 'Frontend', r'\bredux\b|\bzustand\b|\bmobx\b',
  ['Store, actions and reducers', 'Middleware', 'When to use global state'],
  ['Why use Redux instead of component state?', 'What is a reducer?'])

# ---------- Backend ----------
S('Node.js', 'Backend', r'\bnode\.?js\b|\bexpress\.?js\b',
  ['The event loop', 'Streams', 'Async patterns', 'Express middleware', 'Clustering and worker threads'],
  ['How does Node.js handle concurrency with a single thread?', 'What is middleware in Express?',
   'process.nextTick vs setImmediate?'])
S('Spring Boot', 'Backend', r'\bspring\s*(boot|framework|mvc|cloud)\b|\bspring\b(?=\s*[,/)])',
  ['Dependency injection and IoC', 'Annotations', 'REST controllers', 'Spring Data JPA', 'Bean scopes'],
  ['What is dependency injection in Spring?', 'What is the difference between @Component, @Service and @Repository?',
   'How does Spring Boot auto-configuration work?'])
S('Hibernate / JPA', 'Backend', r'\bhibernate\b|\bjpa\b',
  ['Entity mapping', 'Lazy vs eager loading', 'The N+1 query problem'],
  ['What is the N+1 query problem and how do you fix it?'])
S('Django', 'Backend', r'\bdjango\b',
  ['MVT architecture', 'ORM and querysets', 'Middleware', 'Migrations'],
  ['How does the Django ORM work?', 'What is middleware in Django?'])
S('Flask', 'Backend', r'\bflask\b',
  ['Routing', 'Blueprints', 'Application and request context'],
  ['What are blueprints in Flask?'])
S('FastAPI', 'Backend', r'\bfastapi\b',
  ['Async endpoints', 'Pydantic models', 'Dependency injection'],
  ['How does FastAPI use type hints for validation?'])
S('.NET', 'Backend', r'(?<![a-z0-9])\.net\b|\basp\.net\b|\bdotnet\b',
  ['ASP.NET Core pipeline', 'Entity Framework', 'Dependency injection'],
  ['What is middleware in ASP.NET Core?', 'What is Entity Framework?'])
S('REST APIs', 'Backend', r'\brest(ful)?\b|\bapis?\b|\bweb services?\b',
  ['HTTP methods and status codes', 'Idempotency', 'Authentication (JWT, OAuth)', 'Versioning', 'Pagination'],
  ['What makes an API RESTful?', 'PUT vs PATCH?', 'How would you secure an API?'])
S('GraphQL', 'Backend', r'\bgraphql\b',
  ['Schemas and resolvers', 'Queries vs mutations', 'The N+1 problem and DataLoader'],
  ['GraphQL vs REST: what are the trade-offs?'])
S('Microservices', 'Backend', r'\bmicro-?services?\b',
  ['Service boundaries', 'Communication between services', 'API gateway', 'Resilience (circuit breakers)',
   'Data consistency (sagas)'],
  ['Monolith vs microservices: what are the trade-offs?', 'How do services communicate with each other?',
   'How do you keep data consistent across services?'])
S('Messaging (Kafka, RabbitMQ)', 'Backend', r'\bkafka\b|\brabbitmq\b|\bmessage (queues?|brokers?)\b|\bpub/?sub\b|\bsqs\b',
  ['Topics, partitions and consumer groups', 'Delivery guarantees', 'Ordering'],
  ['How does Kafka guarantee ordering?', 'At-least-once vs exactly-once delivery?'])
S('Caching (Redis)', 'Backend', r'\bredis\b|\bmemcached\b|\bcaching\b',
  ['Cache-aside vs write-through', 'Eviction policies', 'Cache invalidation'],
  ['How would you design a cache for a read-heavy service?', 'What eviction policies do you know?'])

# ---------- Data and databases ----------
S('SQL', 'Data & databases', r'\bsql\b|\bt-sql\b|\bpl/sql\b',
  ['Joins', 'GROUP BY and HAVING', 'Subqueries and CTEs', 'Window functions', 'Indexes'],
  ['Find the second highest salary from an Employee table.', 'What is the difference between WHERE and HAVING?',
   'Explain the different types of joins.', 'What are window functions? Give an example with ROW_NUMBER().'])
S('Relational databases', 'Data & databases',
  r'\bmysql\b|\bpostgres(ql)?\b|\bsql server\b|\brdbms\b|\brelational databases?\b|\bdbms\b|\boracle (db|database)\b',
  ['Normalization', 'Indexing', 'Transactions and ACID', 'Isolation levels', 'Query optimisation'],
  ['What is normalization? Explain 1NF, 2NF and 3NF.', 'How does an index speed up a query?',
   'What are the ACID properties?'])
S('NoSQL', 'Data & databases', r'\bnosql\b|\bmongo(db)?\b|\bcassandra\b|\bdynamodb\b|\bcouchbase\b|\bfirestore\b',
  ['Document vs key-value vs wide-column stores', 'The CAP theorem', 'Data modelling', 'Consistency models'],
  ['SQL vs NoSQL: how do you choose?', 'Explain the CAP theorem.'])
S('Data pipelines and warehousing', 'Data & databases',
  r'\betl\b|\belt\b|\bdata warehous\w*|\bsnowflake\b|\bredshift\b|\bbigquery\b|\bdata pipelines?\b|\bairflow\b|\bdbt\b',
  ['ETL vs ELT', 'Star and snowflake schemas', 'Batch vs streaming', 'Orchestration'],
  ['ETL vs ELT: what is the difference?', 'Explain star schema vs snowflake schema.',
   'How would you design a daily data pipeline?'])
S('Big data (Spark, Hadoop)', 'Data & databases', r'\bspark\b|\bpyspark\b|\bhadoop\b|\bhive\b|\bdatabricks\b',
  ['RDDs and DataFrames', 'Transformations vs actions', 'Partitioning and shuffles'],
  ['What is the difference between a transformation and an action in Spark?', 'What causes a shuffle?'])
S('Excel', 'Data & databases', r'\b(ms |microsoft |advanced )?excel\b(?!\s+(in|at)\b)|\bspreadsheets?\b|\bvlookup\b|\bpivot tables?\b',
  ['VLOOKUP / XLOOKUP', 'Pivot tables', 'Conditional formulas', 'Charts'],
  ['VLOOKUP vs INDEX-MATCH?', 'How would you summarise sales by region with a pivot table?'])
S('BI tools (Power BI, Tableau)', 'Data & databases', r'\bpower\s*bi\b|\btableau\b|\blooker\b|\bqlik\b|\bdashboards?\b',
  ['Data modelling', 'DAX or calculated fields', 'Choosing the right chart', 'Dashboard design'],
  ['How would you design a dashboard for a sales team?', 'What is a calculated field?'])
S('Python data stack', 'Data & databases', r'\bpandas\b|\bnumpy\b|\bmatplotlib\b|\bscikit-?learn\b|\bsklearn\b',
  ['DataFrames and indexing', 'groupby and merge', 'Handling missing values', 'Vectorisation'],
  ['How do you handle missing values in pandas?', 'merge vs join vs concat?'])

# ---------- Data science and ML ----------
S('Machine learning', 'Data science & ML', r'\bmachine learning\b|\bml\b',
  ['Bias-variance trade-off', 'Overfitting and regularisation', 'Evaluation metrics', 'Feature engineering',
   'Common algorithms'],
  ['Explain the bias-variance trade-off.', 'How do you handle an imbalanced dataset?',
   'Precision vs recall: when does each matter?', 'How does a random forest work?'])
S('Deep learning', 'Data science & ML', r'\bdeep learning\b|\bneural networks?\b|\btensorflow\b|\bpytorch\b|\bkeras\b|\bcnns?\b|\brnns?\b',
  ['Backpropagation', 'Activation functions', 'CNNs and RNNs', 'Regularisation (dropout, batch norm)'],
  ['How does backpropagation work?', 'Why do we need activation functions?'])
S('NLP and LLMs', 'Data science & ML',
  r'\bnlp\b|\bnatural language\b|\bllms?\b|\blarge language models?\b|\bgenerative ai\b|\bgen ?ai\b|\btransformers?\b|\brag\b|\bprompt engineering\b',
  ['Tokenisation and embeddings', 'Transformers and attention', 'Retrieval-augmented generation', 'Evaluation'],
  ['How does self-attention work?', 'What is retrieval-augmented generation?'])
S('Statistics', 'Data science & ML', r'\bstatistic\w*|\bprobability\b|\bhypothesis test\w*|\ba/b test\w*',
  ['Distributions', 'Hypothesis testing and p-values', 'Confidence intervals', 'A/B testing'],
  ['What is a p-value?', 'How would you design an A/B test?', 'Type I vs type II error?'])
S('Computer vision', 'Data science & ML', r'\bcomputer vision\b|\bopencv\b|\bimage (processing|recognition)\b',
  ['Convolutions', 'Object detection', 'Data augmentation'],
  ['How does a convolution layer work?'])

# ---------- Cloud and DevOps ----------
S('AWS', 'Cloud & DevOps', r'\baws\b|\bamazon web services\b|\bec2\b|\bs3\b|\blambda\b',
  ['EC2, S3 and Lambda', 'IAM', 'VPC basics', 'Managed databases'],
  ['EC2 vs Lambda: when would you use each?', 'How do IAM roles work?', 'What are the S3 storage classes?'])
S('Azure', 'Cloud & DevOps', r'\bazure\b',
  ['App Service and Functions', 'Azure AD / Entra ID', 'Storage accounts'],
  ['What is the difference between Azure Functions and App Service?'])
S('GCP', 'Cloud & DevOps', r'\bgcp\b|\bgoogle cloud\b',
  ['Compute Engine and Cloud Run', 'BigQuery', 'IAM'],
  ['Cloud Run vs GKE: when would you use each?'])
S('Docker', 'Cloud & DevOps', r'\bdocker\b|\bcontaineri[sz]\w*|\bcontainers?\b',
  ['Images vs containers', 'Dockerfile layers', 'Volumes and networking', 'Multi-stage builds'],
  ['What is the difference between an image and a container?', 'How do you keep Docker images small?'])
S('Kubernetes', 'Cloud & DevOps', r'\bkubernetes\b|\bk8s\b|\bhelm\b|\beks\b|\baks\b|\bgke\b',
  ['Pods, deployments and services', 'Scaling', 'ConfigMaps and secrets', 'Health checks'],
  ['What is a pod?', 'How does a Kubernetes service route traffic?', 'Liveness vs readiness probes?'])
S('CI/CD', 'Cloud & DevOps', r'\bci\s*/\s*cd\b|\bcontinuous (integration|delivery|deployment)\b|\bjenkins\b|\bgithub actions\b|\bgitlab ci\b',
  ['Pipeline stages', 'Automated testing in pipelines', 'Deployment strategies (blue-green, canary)'],
  ['Walk me through a CI/CD pipeline you have used.', 'Blue-green vs canary deployments?'])
S('Infrastructure as code', 'Cloud & DevOps', r'\bterraform\b|\binfrastructure as code\b|\biac\b|\bansible\b|\bcloudformation\b|\bpulumi\b',
  ['State management', 'Modules', 'Idempotency'],
  ['What is Terraform state and why does it matter?'])
S('Linux', 'Cloud & DevOps', r'\blinux\b|\bunix\b',
  ['File permissions', 'Processes and signals', 'Common commands', 'Networking commands'],
  ['How do file permissions work in Linux?', 'How would you find what is using a port?'])
S('Git', 'Cloud & DevOps', r'\bgit\b|\bgithub\b|\bgitlab\b|\bbitbucket\b|\bversion control\b',
  ['Branching', 'Merge vs rebase', 'Resolving conflicts'],
  ['Merge vs rebase: what is the difference?', 'How do you undo a commit that was already pushed?'])
S('Monitoring and observability', 'Cloud & DevOps', r'\bprometheus\b|\bgrafana\b|\bobservability\b|\bmonitoring\b|\bdatadog\b|\bsplunk\b|\belk\b',
  ['Metrics, logs and traces', 'Alerting', 'SLIs and SLOs'],
  ['What is the difference between an SLI, an SLO and an SLA?'])

# ---------- CS fundamentals ----------
S('Data structures and algorithms', 'CS fundamentals',
  r'\bdata structures?\b|\balgorithms?\b|\bdsa\b|\bproblem[- ]solving\b|\bcompetitive programming\b',
  ['Arrays and strings', 'Hashing', 'Linked lists', 'Trees and graphs', 'Recursion and dynamic programming',
   'Sorting and searching', 'Time and space complexity'],
  ['Reverse a linked list.', 'Two sum: find two numbers that add up to a target.',
   'Detect a cycle in a linked list.', 'Binary tree level order traversal.', 'Longest substring without repeating characters.'])
S('OOP and design patterns', 'CS fundamentals', r'\boops?\b|\bobject[- ]oriented\b|\bsolid\b|\bdesign patterns?\b',
  ['The four pillars of OOP', 'SOLID principles', 'Common design patterns', 'Composition vs inheritance'],
  ['Explain the four pillars of OOP with examples.', 'What are the SOLID principles?',
   'Explain the singleton and factory patterns.'])
S('System design', 'CS fundamentals',
  r'\bsystem design\b|\bdistributed systems?\b|\bscalab\w*|\bhigh[- ]availability\b|\barchitect\w*|\blow[- ]latency\b|\b(high|low)[- ]level design\b|\bhigh[- ]traffic\b',
  ['Scalability and load balancing', 'Caching', 'Sharding and replication', 'Consistency trade-offs',
   'Queues and asynchronous work', 'Estimating capacity'],
  ['Design a URL shortener.', 'Design a rate limiter.', 'How would you scale a read-heavy service?',
   'Design a notification system.'])
S('Operating systems', 'CS fundamentals', r'\boperating systems?\b|\bmulti-?thread\w*|\bconcurren\w*|\bmemory management\b',
  ['Processes vs threads', 'CPU scheduling', 'Deadlocks', 'Paging and virtual memory', 'Synchronisation'],
  ['What is the difference between a process and a thread?', 'What are the conditions for a deadlock?',
   'What is virtual memory?'])
S('Computer networks', 'CS fundamentals', r'\bcomputer networks?\b|\btcp(/ip)?\b|\budp\b|\bhttps?\b|\bdns\b|\bnetworking protocols?\b|\bosi model\b',
  ['OSI and TCP/IP models', 'TCP vs UDP', 'HTTP and HTTPS', 'DNS'],
  ['What happens when you type a URL into a browser?', 'TCP vs UDP?', 'How does HTTPS keep data secure?'])

# ---------- Testing and quality ----------
S('Testing', 'Testing & quality',
  r'\bunit test\w*|\btest[- ]driven\b|\btdd\b|\bjunit\b|\bpytest\b|\bjest\b|\bmockito\b|\bintegration test\w*|\bautomated tests?\b',
  ['Unit vs integration vs end-to-end tests', 'Mocking', 'Test coverage', 'TDD'],
  ['How do you decide what to unit test?', 'What is mocking and when should you use it?'])
S('Test automation', 'Testing & quality', r'\bselenium\b|\bcypress\b|\bplaywright\b|\bappium\b|\btest automation\b|\bautomation testing\b',
  ['Locators and waits', 'Page object model', 'Flaky tests'],
  ['What is the page object model?', 'How do you deal with flaky tests?'])
S('Manual testing and QA', 'Testing & quality', r'\bmanual testing\b|\btest cases?\b|\bregression testing\b|\bsdlc\b|\bstlc\b|\bbug (tracking|life ?cycle)\b',
  ['Test case design', 'Bug life cycle', 'Regression and smoke testing', 'SDLC and STLC'],
  ['Explain the bug life cycle.', 'Smoke vs sanity testing?', 'How would you test a login page?'])

# ---------- Mobile ----------
S('Android', 'Mobile', r'\bandroid\b|\bjetpack compose\b',
  ['Activity and fragment lifecycle', 'Jetpack components', 'Background work'],
  ['Explain the activity lifecycle.', 'How do you handle configuration changes?'])
S('iOS', 'Mobile', r'\bios\b|\bswiftui\b|\buikit\b',
  ['View controller lifecycle', 'SwiftUI vs UIKit', 'Memory management'],
  ['Explain the view controller lifecycle.'])
S('React Native', 'Mobile', r'\breact native\b',
  ['The bridge and the new architecture', 'Navigation', 'Performance'],
  ['How does React Native render native views?'])
S('Flutter', 'Mobile', r'\bflutter\b|\bdart\b',
  ['Widgets and state', 'State management', 'Rendering'],
  ['Stateless vs stateful widgets?'])

# ---------- Other technical ----------
S('Security', 'Security', r'\bsecurity\b|\bowasp\b|\bencryption\b|\boauth\b|\bjwt\b|\bauthenticat\w*|\bauthori[sz]ation\b',
  ['Authentication vs authorisation', 'OWASP top 10', 'Hashing vs encryption', 'Tokens (JWT, OAuth)'],
  ['Authentication vs authorisation?', 'How do you prevent SQL injection?', 'Hashing vs encryption?'])
S('Agile', 'Practices', r'\bagile\b|\bscrum\b|\bkanban\b|\bsprints?\b',
  ['Scrum roles and ceremonies', 'Estimation', 'Working with product owners'],
  ['How does your team run a sprint?'])
S('Product sense', 'Product & business', r'\bproduct (sense|strategy|roadmap|management|thinking)\b|\buser research\b|\bprioriti[sz]\w*|\bgo-to-market\b',
  ['Defining users and problems', 'Prioritisation frameworks', 'Metrics and success criteria'],
  ['How would you improve a product you use every day?', 'How do you prioritise a roadmap?',
   'What metrics would you track for a new feature?'])
S('Stakeholder management', 'Product & business', r'\bstakeholders?\b|\bcross-functional\b',
  ['Aligning priorities', 'Communicating trade-offs', 'Managing expectations'],
  ['Tell me about a time you had to push back on a stakeholder.'])
S('Business analysis', 'Product & business', r'\bbusiness analysis\b|\brequirements? gathering\b|\buser stories\b|\bbrd\b|\bprocess mapping\b',
  ['Requirements gathering', 'User stories and acceptance criteria', 'Process mapping'],
  ['How do you gather requirements from a non-technical stakeholder?'])

# ---------- Soft skills (behavioural questions) ----------
S('Communication', 'Soft skills', r'\bcommunicat\w*|\bpresentation skills\b|\binterpersonal\b',
  ['Explaining technical ideas simply', 'Written updates'],
  ['Tell me about a time you explained something technical to a non-technical person.'])
S('Teamwork', 'Soft skills', r'\bteam[- ]?(work|player)\b|\bcollaborat\w*',
  ['Working across teams', 'Handling disagreement'],
  ['Tell me about a disagreement with a teammate and how you resolved it.'])
S('Leadership', 'Soft skills', r'\bleadership\b|\bmentor\w*|\blead (a|the) team\b|\bpeople management\b',
  ['Leading without authority', 'Mentoring', 'Making decisions'],
  ['Describe a time you led a project or mentored someone.'])
S('Ownership', 'Soft skills', r'\bownership\b|\bself[- ]starter\b|\bproactive\b|\bbias for action\b|\baccountab\w*',
  ['Taking initiative', 'Seeing things through'],
  ['Tell me about a time you took ownership of a problem outside your role.'])
S('Customer focus', 'Soft skills', r'\b(customer|client)[- ](facing|focus\w*|obsess\w*|centric)\b|\bclient handling\b',
  ['Understanding customer needs', 'Handling difficult conversations'],
  ['Tell me about a time you handled a difficult customer or stakeholder.'])

COMPILED = [(s, re.compile(s['pattern'], re.I)) for s in SKILLS]
CATEGORY_ORDER = ['Languages', 'Frontend', 'Backend', 'Data & databases', 'Data science & ML', 'Cloud & DevOps',
                  'CS fundamentals', 'Testing & quality', 'Mobile', 'Security', 'Practices', 'Product & business',
                  'Soft skills']


def find_skills(text):
    """Skills mentioned in text -> {name: number of mentions}."""
    out = {}
    for s, rx in COMPILED:
        n = len(rx.findall(text or ''))
        if n:
            out[s['name']] = n
    return out


def skill(name):
    return next((s for s in SKILLS if s['name'] == name), None)


def public(s, **extra):
    """What the browser needs to show and match a skill."""
    return {'name': s['name'], 'category': s['category'], 'pattern': s['pattern'],
            'topics': s['topics'], 'questions': s['questions'], **extra}
